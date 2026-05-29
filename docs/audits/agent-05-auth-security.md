# Auth & Security Domain Audit — BidStack 360°

**Auditor:** Agent-05 (read-only)  
**Scope:** Auth middleware, permission system, Clerk integration, API key handling, secrets management, CORS, rate limiting, audit logging, input sanitization  
**Date:** 2026-05-23  
**Score:** 72 / 100

---

## 1. Score Rationale

| Dimension               | Weight | Sub-score | Notes                                                                                                                                                        |
| ----------------------- | ------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Authentication          | 25     | 22        | Clerk JWT + dev stub are well-implemented; cross-org guards, SSO domain restriction, and JIT provisioning are solid.                                         |
| Authorization (RBAC)    | 25     | 12        | Permission model and matrix are well-designed, but **enforcement is missing on ~80% of routes**. Any authenticated org member can read/write most resources. |
| Secret / Key Management | 20     | 14        | API keys hashed (SHA-256), prefix logged only, audit-sampled. No expiry/rotation. .env.example is clean.                                                     |
| Rate Limiting & Infra   | 20     | 16        | Redis-backed shared limits for MCP (good). Main API rate limit skipped in `test` env and fail-open on Redis outage.                                          |
| Audit & Observability   | 10     | 8         | Auth events audited. Data-mutation audit is inconsistent (opportunities/files yes, contacts/leads/tasks no).                                                 |

**Total: 72 / 100**

---

## 2. Strengths

- **Clerk JWT verification with SSO domain restriction**  
  `apps/api/src/plugins/auth.ts:130-161` verifies the token via `@clerk/backend`, then enforces `SSO_ALLOWED_EMAIL_DOMAINS` before the session is established. Cross-org user/email collisions are blocked and audit-logged.

- **RBAC plugin with no admin claim fallback**  
  `apps/api/src/plugins/rbac.ts:62-68` explicitly removed the `req.auth.role === 'admin'` shortcut. Admins must hold an explicit `UserRole` grant. This prevents privilege escalation when the database is not yet seeded.

- **Auth audit logging is fire-and-forget and safe**  
  `apps/api/src/plugins/auth-audit.ts:52-88` swallows Prisma errors so an audit-write failure never 5xx's a sign-in flow. It also guards against empty `orgId` to prevent schema constraint crashes.

- **Penetration-test suite guards regressions**  
  `apps/api/src/security/penetration.test.ts` covers auth bypass (expired JWT, foreign issuer), IDOR (cross-tenant 404 not 403), SQL injection through Prisma, file upload bypass (SVG script rejection), webhook HMAC forgery, replay windows, and mass-assignment.

- **API keys hashed at rest; secrets never logged**  
  `apps/mcp-server/src/auth.ts:80` stores `SHA-256(token)` only. The audit diff records a 12-char prefix, never the full key (`apps/mcp-server/src/auth.ts:56-69`). Pino redacts `authorization`, `cookie`, and `*.secret` paths (`apps/api/src/server.ts:147-164`).

- **Redis-backed sliding-window rate limiter for MCP**  
  `apps/mcp-server/src/plugins/hourly-rate-limit.ts` fixed the previous HIGH-1 finding by moving counters from an in-memory `Map` to Redis, so replica count no longer multiplies the attacker's budget.

- **Tenant ownership guards prevent IDOR**  
  `apps/api/src/lib/tenant-ownership.ts:90-134` provides `tenantEntityBelongsToOrg` with explicit Prisma `count` checks per entity type, used by file finalize and other sensitive routes.

- **CORS rejects localhost in production**  
  `apps/api/src/server.ts:227-228` explicitly blocks `localhost` origins when `NODE_ENV === 'production'`, preventing a common misconfiguration vector.

- **Error handler sanitizes 4xx/5xx responses**  
  `apps/api/src/plugins/error-handler.ts:56-78` maps status codes to safe labels (`Bad Request`, `Unauthorized`, etc.) and never echoes raw error messages, stack traces, or SQL fragments.

- **Secret scanning in CI + pre-commit**  
  `.github/workflows/gitleaks.yml`, `.github/workflows/semgrep.yml`, `scripts/check-secrets.sh`, and `.gitleaks.toml` provide layered detection for credentials in git history.

---

## 3. P0 Gaps — Critical

### P0-1 RBAC not enforced on the majority of API routes

The permission matrix (`packages/shared/src/types/rbac-matrix.ts`) defines 54 granular keys and 6 canonical roles, but most CRUD routes rely solely on the global `authPlugin` (authentication + org scoping) and never call `requirePermission`. **Any authenticated user in an org can create, update, delete, and read leads, contacts, tasks, activities, opportunities, companies, notes, proposals, etc.**

- `apps/api/src/routes/opportunities.ts:27-35` — GET `/opportunities` has no `preHandler`
- `apps/api/src/routes/opportunities.ts:121-129` — POST `/opportunities` has no `preHandler`
- `apps/api/src/routes/opportunities.ts:292-300` — PATCH `/opportunities/:id` has no `preHandler`
- `apps/api/src/routes/opportunities.ts:430-437` — DELETE `/opportunities/:id` has no `preHandler`
- `apps/api/src/routes/contacts.ts:39-47` — GET `/contacts` has no `preHandler`
- `apps/api/src/routes/leads.ts:27-35` — GET `/leads` has no `preHandler`
- `apps/api/src/routes/tasks.ts:58-66` — GET `/tasks` has no `preHandler`
- `apps/api/src/routes/activities.ts:67-80` — GET `/entities/.../activities` has no `preHandler`

**Risk:** Privilege escalation within tenant. A Read-Only user can mutate records; an SDR can write opportunities; a Customer Success rep can write proposals.

**Fix:** Add `preHandler: server.requirePermission('resource:read')` / `resource:write` to every route, or introduce a default-deny middleware that consults the RBAC service when no explicit permission is declared.

---

### P0-2 No CSRF protection on state-changing endpoints

The API sets `credentials: true` in CORS (`apps/api/src/server.ts:232`) and accepts cookies, but there are no CSRF tokens, `SameSite=Strict` cookie settings, or `X-CSRF-Token` header checks. The frontend uses Bearer tokens for Clerk, but if session cookies are ever introduced (or if a third-party integration uses cookie auth), state-changing POST/PATCH/DELETE requests are vulnerable to cross-site request forgery.

**Risk:** OWASP A01:2021 — Broken Access Control (CSRF subset).

**Fix:** If cookies are used for auth, set `SameSite=Strict; Secure; HttpOnly` and validate a double-submit cookie or synchronizer token on mutating methods.

---

### P0-3 Zapier routes bypass global auth plugin and lack rate limits

`apps/api/src/routes/integrations/zapier.ts:63-81` marks all Zapier endpoints `config: { public: true }`, which skips the Clerk auth plugin entirely. While inline API-key auth is performed, **no per-route rate limit is configured** (`rateLimit` config is absent). An attacker with a stolen Zapier API key can hammer these endpoints without hitting the global per-minute or per-hour caps.

**Risk:** Account takeover via key brute-force or credential stuffing against the Zapier key hash.

**Fix:** Add `config: { rateLimit: { max: ..., timeWindow: '1 minute' } }` to every Zapier route, or move Zapier auth into a dedicated Fastify `onRequest` hook so the global rate limiter can attribute requests correctly.

---

## 4. P1 Gaps — High

### P1-1 Inconsistent audit-log coverage for data mutations

Routes that mutate business data do not uniformly write `auditLog` rows:

- **Audited:** `opportunities.ts` (create, update, delete, stage), `files.ts` (upload, delete), `roles.ts` (create, update, delete), `dust-integration.ts` (push-deal, resync, apikey create/revoke)
- **Not audited:** `contacts.ts` (create/update/delete), `leads.ts` (create/update/delete/convert), `tasks.ts` (create/update/delete), `activities.ts` (create/update), `notes.ts`, `companies.ts`

**Risk:** Compliance and forensics gaps. A malicious insider can modify or delete records without a durable trail.

**Fix:** Add `auditLog.create` inside Prisma transactions for every mutating route, or introduce a centralized Prisma middleware that auto-logs all `create`, `update`, `delete` operations against auditable models.

---

### P1-2 API keys have no expiry or automatic rotation

`apps/api/src/routes/dust-integration.ts:616-669` creates keys with `revokedAt: null` but no `expiresAt` column or rotation workflow. A leaked key is valid indefinitely until manually revoked.

**Risk:** Long-lived credentials increase blast radius of a leak.

**Fix:** Add an `expiresAt` column to `ApiKey`, default new keys to 90 days, and expose a `POST /api-keys/:id/rotate` endpoint that creates a successor key and revokes the old one with a 24-hour grace period.

---

### P1-3 Main API rate limiter is disabled in `test` and fails open

`apps/api/src/server.ts:263-275` skips `@fastify/rate-limit` entirely when `NODE_ENV === 'test'`. In production it uses Redis with `skipOnError: true`, meaning a Redis outage disables rate limiting across all API routes.

**Risk:** Availability / DoS during Redis maintenance or network partition.

**Fix:** Keep the short-window rate limit enabled in test (with a high cap if needed). In production, consider failing closed on rate-limit Redis errors for non-health endpoints, or implement a local LRU fallback with a reduced budget.

---

### P1-4 Session invalidation is not server-side

Clerk JWTs are verified locally. There is no server-side session deny-list or logout hook that invalidates outstanding tokens. If a user is deactivated in Clerk, their existing JWT remains valid until expiry.

**Risk:** Insider threat / offboarding lag. A terminated employee can continue accessing the API with a cached token.

**Fix:** Add a lightweight session cache (Redis) keyed by `userId` that stores the latest `iat` (issued-at) boundary. Reject tokens with `iat` older than the boundary when the user logs out or is deactivated.

---

### P1-5 `dust-integration.ts` `/dust/status` and `/webhooks` lack permission gates

`apps/api/src/routes/dust-integration.ts:541-551` (GET `/dust/status`) and `:704-742` (GET `/webhooks`) have no `preHandler`. Any authenticated org member can read integration status and recent webhook events.

**Risk:** Information disclosure. Low-sensitivity, but inconsistent with the principle that every route declares its required permission.

**Fix:** Add `preHandler: server.requirePermission('integrations:read')` to both routes.

---

## 5. P2 Gaps — Medium / Hardening

### P2-1 `securityHeadersPlugin` is orphaned

`apps/api/src/plugins/security-headers.ts:9-14` contains a `WIRE-UP TODO (post-merge)` comment. The plugin is **never registered** in `server.ts`. Helmet is configured inline (`server.ts:182-218`) and an additional inline `onSend` hook sets `Permissions-Policy`, but the canonical plugin is dead code.

**Fix:** Register `securityHeadersPlugin` after helmet and remove the inline duplication.

---

### P2-2 No bot protection on public endpoints

`/public/nps/:token` (`public-nps.ts:252-264`) and `/book/:slug` (public booking pages) are unauthenticated and lack CAPTCHA, honeypot, or rate-limit headers. They are susceptible to automated spam / enumeration.

**Fix:** Add a lightweight honeypot field or Cloudflare Turnstile to the NPS form and booking pages.

---

### P2-3 Dev stub auth grants `read` + `write` scopes unconditionally

`apps/api/src/plugins/auth.ts:56-57` hardcodes `scopes: ['read', 'write']` for stub mode. While stub is dev-only, this masks RBAC bugs because every dev/test request appears to have full scopes.

**Fix:** Make stub scopes configurable via env (e.g. `STUB_AUTH_SCOPES=read`) so developers can test permission-denied paths without Clerk.

---

### P2-4 Missing `Secure` and `SameSite` cookie directives

The API reads cookies (`req.headers.cookie`) but the application does not explicitly set `Set-Cookie` headers with `Secure; HttpOnly; SameSite=Strict` on the API side. If Clerk or any integration ever sets session cookies, they may inherit insecure defaults.

**Fix:** Audit all `Set-Cookie` paths and enforce secure attributes via a Fastify `onSend` hook or helmet cookie settings.

---

### P2-5 `auth.ts` catch-all suppresses token-signature details

`apps/api/src/plugins/auth.ts:311-319` catches all Clerk verification errors and returns a generic `401`. While safe against information leakage, it also **swallows `TokenExpiredError`**, making it impossible for the frontend to distinguish "needs refresh" from "invalid token".

**Fix:** Inspect the error type and return `401` with a distinct `code: 'token_expired'` in the body for expired tokens only.

---

## 6. Evidence

### Missing RBAC enforcement

```ts
// apps/api/src/routes/opportunities.ts:27-35
server.get(
  '/opportunities',
  {
    schema: {
      querystring: OpportunityFilter,
      response: { 200: OpportunityPage },
    },
  },
  async (req) => {
    /* no preHandler, no requirePermission */
  },
);
```

### Orphaned security headers plugin

```ts
// apps/api/src/plugins/security-headers.ts:9-14
/**
 * WIRE-UP TODO (post-merge):
 *   In apps/api/src/server.ts, after the helmet registration block, add:
 *
 *     import { securityHeadersPlugin } from './plugins/security-headers.js';
 *     await server.register(securityHeadersPlugin);
 *
 * NOTE: The current server.ts already sets Permissions-Policy inline via an
 * onSend hook. This plugin is the canonical replacement; once wired, remove
 * the inline hook.
 */
```

### API key creation with no expiry

```ts
// apps/api/src/routes/dust-integration.ts:632-644
const created = await prisma.$transaction(async (tx) => {
  const key = await tx.apiKey.create({
    data: {
      orgId: req.auth.orgId,
      name: req.body.name,
      hashedKey,
      prefix,
      scopes: req.body.scopes,
      // expiresAt is absent from the schema and the create call
    },
  });
  // ...
});
```

### Rate limit skipped in test environment

```ts
// apps/api/src/server.ts:263-275
if (config.NODE_ENV !== 'test') {
  await server.register(rateLimit, {
    max: config.NODE_ENV === 'development' ? 10_000 : config.API_RATE_LIMIT_MAX,
    timeWindow: '1 minute',
    redis: redis.status === 'ready' || redis.status === 'connect' ? redis : undefined,
    // ...
  });
}
```

### CORS credentials without CSRF token

```ts
// apps/api/src/server.ts:219-233
await server.register(cors, {
  origin: (origin, cb) => {
    /* ... */
  },
  credentials: true,
});
// No csrfProtection plugin registered afterward
```

### Pino redaction of sensitive headers (positive evidence)

```ts
// apps/api/src/server.ts:147-164
redact: {
  paths: [
    'req.headers.authorization',
    'req.headers.cookie',
    'req.headers["x-api-key"]',
    'req.headers["x-clerk-session"]',
    'res.headers["set-cookie"]',
    '*.bearerToken',
    '*.apiKey',
    '*.secret',
    // ...
  ],
  remove: true,
}
```

---

## 7. Summary

BidStack 360° has a **strong authentication foundation**: Clerk JWT verification is correctly implemented, tenant isolation is enforced, API keys are hashed, and a penetration-test suite guards against common OWASP vectors. Secret management in CI is mature (gitleaks + Semgrep + custom scanner).

The domain's biggest weakness is **authorization completeness**. The RBAC matrix and permission keys are well-defined, but the enforcement layer is only wired to a handful of admin/settings routes. **The vast majority of business CRUD endpoints trust any authenticated org member**, which means the 6 canonical roles (Admin, Sales Manager, Account Executive, SDR, Customer Success, Read-Only) are effectively honorary labels rather than access controls. Closing this gap by adding `requirePermission` preHandlers across all routes would raise the score into the high 80s.

**Recommended priority order:**

1. P0-1 — Add RBAC preHandlers to all CRUD routes (or build a default-deny middleware).
2. P0-2 — Introduce CSRF tokens if cookies are ever used for auth; document the Bearer-only posture otherwise.
3. P0-3 — Rate-limit Zapier public routes.
4. P1-1 — Uniform audit-log coverage via middleware or manual additions.
5. P1-2 — API key expiry + rotation workflow.
6. P2-1 — Wire up the orphaned `securityHeadersPlugin`.

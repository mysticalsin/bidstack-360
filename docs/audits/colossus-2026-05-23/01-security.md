# Security Audit Report — BIDCRM 360° (Colossus Deep Audit)

**Date:** 2026-05-23  
**Scope:** Full monorepo (`apps/api`, `apps/web`, `apps/worker`, `apps/mcp-server`, `packages/*`)  
**Methodology:** Static code review against OWASP Top 10 2021 + custom S-M checks + targeted exploit-path analysis  
**Auditor:** Security Audit Agent (Kimi Code CLI)  
**Cross-reference:** `docs/AUDIT_REPORT.md` (2026-05-12) — findings already fixed in that report are **not duplicated** below.

---

## Executive Summary (Top 5 Risks)

| # | Risk | Severity | Why It Matters |
|---|------|----------|----------------|
| 1 | **Microsoft OAuth placeholder uses predictable `state` parameter** | Medium | When the placeholder is replaced with a real `client_id`, the OAuth flow will be vulnerable to CSRF because `state=${userId}` is guessable. An attacker can force-link a victim's Microsoft identity to their own session. |
| 2 | **Frontend CSP completely absent on static SPA** | Medium | The Vite-built SPA has no `<meta>` CSP and contains an inline script that prevents strict `script-src` adoption. If an XSS vector is introduced in future, there is no second line of defense. |
| 3 | **Zod validation errors leak full schema internals to clients** | Low | The error handler returns `err.issues` verbatim, exposing field names, constraints (`min`, `max`, `regex`), and expected types. This aids attacker reconnaissance. |
| 4 | **Pre-commit secret-scan misses most project-specific keys** | Low | `check-secrets.sh` only matches generic patterns (OpenAI `sk-`, AWS `AKIA`, GitHub `ghp_`). It misses Clerk, Dust, Anthropic, Apollo, Odoo, and generic Bearer tokens that exist in the codebase. |
| 5 | **Dust push helper lacks org-scoped queries** | Low | `lib/dust-push.ts` reads opportunities/leads by `id` alone. While current callers pass already-validated IDs, the helper is a latent IDOR foot-gun if reused in future routes. |

**Overall posture:** Strong. The 2026-05-12 audit remediated the only exploitable issues (IDOR in mentions, CSV formula injection, SSRF `0.0.0.0` gap). This deep pass found **no Critical or High severity vulnerabilities**. All new findings are defense-in-depth gaps or pre-production code smells.

---

## Findings Table

| Severity | File | Line | Issue | Evidence | Fix Recommendation |
|----------|------|------|-------|----------|--------------------|
| **Medium** | `apps/api/src/routes/microsoft.ts` | 80–82 | OAuth `state` parameter is predictable (`state=${userId}`) | `const placeholderUrl = \`https://login.microsoftonline.com/...&state=${userId}\`;` | Replace with a cryptographically random nonce stored in the session or DB, validated on callback. Do not ship this route until fixed. |
| **Medium** | `apps/web/index.html` | 23–33 | Inline script blocks strict CSP adoption; no CSP meta tag present | `<script>…document.documentElement.dataset.theme = theme;</script>` | Move theme script to an external JS file (e.g., `/theme-head.js`) and add a `<meta http-equiv="Content-Security-Policy" …>` to the built `index.html` or inject it at the edge (CDN/ingress). |
| **Low** | `apps/api/src/plugins/error-handler.ts` | 12–18 | Zod validation errors leak internal schema structure | `return reply.status(400).send({ … issues: err.issues });` | Map `err.issues` to a safe shape before sending: strip `path`, `minimum`, `maximum`, `validation`, and return only `message` + a generic `field` name. |
| **Low** | `apps/api/src/plugins/error-handler.ts` | 22–28 | Unique-constraint error (P2002) confirms record existence | `return reply.status(409).send({ … message: 'A record with this unique value already exists.' });` | In high-sensitivity contexts (registration, email, code), return a generic 409 without confirming existence, or merge into the same message as validation errors. |
| **Low** | `scripts/check-secrets.sh` | 22 | Regex misses most secrets used by the project | `PATTERNS='sk-[A-Za-z0-9]{20,}|sk_live_…'` | Expand patterns to include: `clerk|publishable|secret_key`, `dust|api_key|workspace`, `anthropic|api_key`, `apollo|api_key`, `odoo|api_key|password`, generic `bearer\s+[a-zA-Z0-9_\-]{20,}`, and base64-encoded `BEGIN.*PRIVATE KEY`. |
| **Low** | `apps/api/src/lib/dust-push.ts` | 63, 98 | `findUnique` queries lack `orgId` scoping | `prisma.opportunity.findUnique({ where: { id: oppId } })` | Add `orgId` to the `where` clause, or pass `orgId` into the helper and validate ownership before pushing. |
| **Low** | `apps/api/src/routes/plugins.ts` | 68–73 | Plugin manifest is hardcoded; SSRF check is a no-op | `const manifest = { name: 'Custom Plugin', version: '1.0.0', … };` | When implementing manifest fetching, ensure the `fetch()` call reuses the same `isPublicHostname(url.hostname)` validation and follows redirects with the same check. |
| **Info** | `apps/api/src/server.ts` | 137–176 | Helmet CSP is set on API responses only | `await server.register(helmet, { contentSecurityPolicy: { … } });` | Ensure the built `index.html` (served by nginx/CDN) also emits an equivalent CSP; API Helmet does not protect the SPA shell. |
| **Info** | `apps/api/src/routes/exchange-rates.ts` | 21–24 | Public endpoint makes outbound fetch | `config: { public: true }` + `fetch('https://open.er-api.com/v6/latest/EUR')` | Monitor for SSRF if the URL ever becomes user-configurable. Currently safe because URL is hardcoded. |
| **Info** | `apps/api/src/routes/agents.ts` | 223 | Anthropic API call uses env-controlled base URL without SSRF guard | `fetch(process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com/…')` | This is acceptable because the value is server-configured, not user-supplied. Document the assumption. |
| **Info** | `apps/api/src/config.ts` | 38 | `API_RATE_LIMIT_MAX` defaults to 120 with no per-org cap | `API_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120)` | Consider adding a per-org rate-limit tier for multi-tenant fairness. |
| **Info** | `.env.example` | 1–103 | Example file is well-structured but `POSTGRES_PASSWORD` is empty | `POSTGRES_PASSWORD=` | Add a comment reminding devs to generate a password; ensure `DATABASE_URL` is never logged. |

---

## Detailed Analysis by Category

### 1. Authentication & Authorization

**Clerk JWT Verification (`apps/api/src/plugins/auth.ts`)**
- `verifyToken` from `@clerk/backend` is used with `secretKey` and `authorizedParties`.
- `authorizedParties` is `[process.env.PUBLIC_BASE_URL ?? ''].filter(Boolean)` — if `PUBLIC_BASE_URL` is unset, the array is empty, which may disable the audience check depending on Clerk's behavior. **Verify** that Clerk treats an empty `authorizedParties` array as "allow all" vs "allow none." If it's "allow all," this is a Low finding.
- SSO domain restriction (`SSO_ALLOWED_EMAIL_DOMAINS`) is enforced after token verification. Good.
- Cross-org migration checks prevent a user from switching organizations using the same Clerk identity. Good.
- Stub auth is strictly gated to `development` and `test`. Good.

**RBAC (`apps/api/src/plugins/rbac.ts`)**
- `requireRole` and `requirePermission` both scope `userRole.count` queries to `req.auth.orgId`. Good.
- Transitional fallback allows `admin` role to pass any permission check. This is documented and acceptable during migration.

**API Keys (`apps/api/src/routes/dust-integration.ts:292–346`)**
- Keys are SHA-256 hashed at rest; only the prefix and a 12-char secret are returned once on creation. Good.
- No API-key-based auth middleware was found in the current route set — all routes use Clerk JWT. The `agents.ts` file sets `x-api-key` for outbound Anthropic calls only.

### 2. Injection (SQL, NoSQL, Command)

**SQL Injection via `$queryRaw`**
- All `$queryRaw` usages in production code use Prisma's tagged-template parameterization:
  - `search.ts:62–66` — `${req.auth.orgId}::uuid`, `${like}`, `${perTypeLimit}`
  - `sales-intelligence.service.ts:90–107` — `${orgId}::uuid`, `${limit}`
  - `company.service.ts:46–57` — `${orgId}::uuid`, `${limit * 2}`
  - `sales-dashboard.service.ts:141–153` — `${orgId}::uuid`, `${from}`, `${to}`
- **No string concatenation into SQL found.** ✅ PASS

**Command Injection**
- No `child_process.exec`, `spawn` with user input, or shell metacharacters found.
- OCR binaries (`ocrmypdf`, `tesseract`) are hardcoded in `config.ts`. Good.

### 3. XSS & Frontend Security

**XSS Sinks**
- Current `apps/web/src/components/notes/NotesPanel.tsx` (line 274) explicitly avoids `dangerouslySetInnerHTML`. The `SafeMarkdownPreview` component renders via React nodes only. ✅ PASS
- **Historical worktrees** (`.claude/worktrees/*/NotesPanel.tsx`) contain `dangerouslySetInnerHTML` + `renderInlineMarkdown`, but those are stale branches, not deployed code. Clean up worktrees to reduce confusion.
- No `eval()`, `new Function()`, or inline event handlers found in `apps/web/src`. ✅ PASS

**CSP**
- API Helmet CSP (`server.ts:137–176`) is robust for API responses, but the SPA shell is served statically and receives **no CSP**.
- The inline theme script in `index.html:23–33` means even if a meta CSP is added, `script-src` must include `'unsafe-inline'` or a nonce. **Recommendation:** externalize the script.

### 4. CSRF

- The API uses Bearer token auth (`Authorization: Bearer <JWT>`), not cookie-based sessions. Browsers do not automatically attach Bearer tokens to cross-origin requests, so classic CSRF is not applicable. ✅ PASS
- **Exception:** The Microsoft OAuth route (`microsoft.ts`) will be vulnerable to OAuth CSRF when activated due to the predictable `state` parameter (see Findings Table).

### 5. IDOR & Org Scoping

- Every mutating route inspected uses `findFirst({ where: { id, orgId } })` before updating.
- `tenantEntityBelongsToOrg` is used in `bid-workspace.ts` and `files.ts` for secondary entity validation. Good.
- **Latent risk:** `dust-push.ts` helpers read by `id` alone. While current callers pass validated IDs, the helper is not defensive. (See Findings Table.)

### 6. SSRF

- `isPublicHostname` (`apps/api/src/lib/ssrf-guard.ts`) blocks: `localhost`, `127.0.0.1`, `0.0.0.0`, `10.x`, `172.16–31.x`, `192.168.x`, `169.254.x`, `.local`. ✅ PASS
- Enforced in: `workflows.ts` (`call_webhook`), `plugins.ts` (`manifestUrl`), `webhook-subscriptions.ts` (`url`). ✅ PASS
- **Note:** `plugins.ts` currently hardcodes the manifest and never fetches the URL, so the SSRF check is a guard for future implementation.

### 7. File Uploads

- `files.ts` enforces `keyBelongsToOrg` on upload and finalize. Good.
- `storage/index.ts` uses `safeJoin` to prevent path traversal (`../`). Good.
- `safeContentDisposition` strips control chars and percent-encodes filenames. Good.
- Size cap: `FILE_MAX_BYTES` (default 50 MB). Good.
- **Note:** No malware scan integration is active (`STORAGE_SCAN_REQUIRED` defaults to unset). This is acceptable for the current threat model.

### 8. Webhooks & Signature Verification

- Dust inbound webhook (`webhooks.ts`) uses constant-time HMAC comparison via `verifyDustSignature` (`packages/dust-client/src/index.ts:214–242`). ✅ PASS
- Timestamp skew enforced: ±5 minutes. ✅ PASS
- Event-id dedup via Redis `SET NX EX 7d` with in-process fallback capped at 10,000 entries. ✅ PASS
- Org resolution is derived from the DB subscription row matching the secret, not from client headers. ✅ PASS

### 9. CORS

- `server.ts:177–191`: Origin whitelist is `[process.env.PUBLIC_BASE_URL]` plus localhost in dev.
- `credentials: true` is set, which is safe because the whitelist is strict and localhost is rejected in production.
- **Minor:** The origin check uses exact string equality (`allowed.includes(origin)`). If `PUBLIC_BASE_URL` has a trailing slash or the frontend accesses via `www.` vs apex, CORS will block. Use `new URL(origin).origin` normalization or document the requirement.

### 10. Secrets & Env Exposure

- `.env.example` does not contain real secrets. Good.
- Pino redact strips: `authorization`, `cookie`, `x-api-key`, `x-clerk-session`, `set-cookie`, `*.bearerToken`, `*.apiKey`, `*.password`, `*.secret`, plus axios error headers. Good.
- **Pre-commit gap:** `check-secrets.sh` regex is too narrow (see Findings Table).
- **No `.env` file found in repo root** — only `.env.example` is tracked. Good.
- **Vite env leakage:** `VITE_CLERK_PUBLISHABLE_KEY` and `VITE_API_URL` are correctly prefixed with `VITE_` and are public by design. No secret keys are exposed to the browser bundle. Good.

### 11. JWT Handling

- Clerk JWTs are verified server-side with `verifyToken`. No custom JWT parsing or `jsonwebtoken` library usage found. Good.
- Tokens are not stored in `localStorage` or cookies by the frontend; Clerk manages its own secure session. Good.

### 12. Rate Limiting

- Global rate limit: 600 req/min in production (configurable via `API_RATE_LIMIT_MAX`).
- Per-route limits exist on sensitive endpoints (`/api-keys`, `/webhooks/dust`, `/opportunities`, `/files/upload-url`, `/workflows/:id/run`, `/plugins`, `/service-cases`). Good.
- Rate limit is **disabled** in `test` env. Ensure `NODE_ENV=test` cannot be set in production (the config schema enforces this, but verify at the infra layer).

---

## Cross-Reference with `docs/AUDIT_REPORT.md` (2026-05-12)

| Previous Finding | Status | Notes |
|------------------|--------|-------|
| F-1 — IDOR in `POST /api/mentions/:id/read` | ✅ Fixed | `collaboration.ts` now scopes by `orgId` + `userId`. |
| F-2 — CSV Formula Injection | ✅ Fixed | `csv.ts` sanitizes formula triggers. |
| F-3 — SSRF `0.0.0.0` gap | ✅ Fixed | Added to `isPublicHostname`. |
| S-M4 — XSS sinks | ✅ Pass | No `dangerouslySetInnerHTML` in deployed code. |
| S-M6 — File Upload Restrictions | ✅ Pass | Size, type, path-traversal guards verified. |
| S-M7 — Secret Logging | ✅ Pass | Pino redact covers all sensitive headers. |
| S-M8 — Replay Attacks | ✅ Pass | HMAC + dedup + timestamp skew verified. |
| S-M9 — Rate Limiting | ✅ Pass | Enhanced with per-route limits. |
| S-M10 — SSRF | ✅ Pass | URL validation in workflows, plugins, webhooks. |
| Deferred — CSP nonce for inline theme script | 🔶 Still open | Confirmed still present; see new Finding #2. |
| Deferred — Validate search result URLs on frontend | 🔶 Still open | `search.ts` returns `/opportunities/${o.id}` etc., which are path-absolute and safe. No action needed unless external URLs are introduced. |

---

## Recommendations (Prioritized)

1. **(Medium)** Before enabling Microsoft OAuth, replace `state=${userId}` with a cryptographically random nonce and validate it on callback.
2. **(Medium)** Move the inline theme script from `index.html` to an external file and add a CSP `<meta>` tag (or inject CSP at the CDN/ingress layer).
3. **(Low)** Sanitize Zod `err.issues` in the error handler to avoid leaking schema internals.
4. **(Low)** Expand `check-secrets.sh` regex to cover Clerk, Dust, Anthropic, Apollo, Odoo, and generic Bearer tokens.
5. **(Low)** Add `orgId` scoping to `dust-push.ts` helpers for defense-in-depth.
6. **(Info)** Clean up stale `.claude/worktrees/*` branches that contain old `dangerouslySetInnerHTML` patterns to reduce auditor confusion.
7. **(Info)** When implementing plugin manifest fetching, ensure redirect-following re-validates `isPublicHostname` on every hop.

---

*Report generated by automated static analysis. Re-run after any route, auth, or webhook change.*

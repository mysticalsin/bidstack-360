# Threat Model — BidStack 360°

**Owner:** Security Engineering
**Last reviewed:** 2026-05-24
**Methodology:** STRIDE per asset, prioritised by likelihood × business impact.
**Companion docs:** `SECURITY.md` (disclosure policy), `apps/api/src/security/penetration.test.ts` (regression suite for the controls below).

This is a living document. Re-read on every architectural change that crosses a trust boundary (new public endpoint, new third-party integration, new shared store, new auth path).

---

## 1. System overview

BidStack 360° is a multi-tenant bid / pre-sales CRM. The relevant trust boundaries are:

```
[Browser]
   │  (HTTPS, Clerk session JWT on Authorization header)
   ▼
[apps/web — Vite SPA, Clerk component-level guards]
   │
   ▼
[apps/api — Fastify, auth plugin verifies Clerk JWT, RBAC plugin gates routes]
   │              │                │                │                │
   ▼              ▼                ▼                ▼                ▼
[Postgres 16]  [Redis 7]  [Local FS / S3]  [Dust webhooks]  [Odoo MCP / 3p]
                                              (HMAC inbound)   (outbound only)
                          ▲
                          │
                  [apps/worker — BullMQ consumers]
                          ▲
                          │
                  [apps/mcp-server — agent tool surface, hashed API keys]
```

Every Prisma write on a tenant table includes `orgId`. Every webhook is HMAC-verified, timestamp-windowed, and event-id deduped. Every storage key is prefixed with `orgId/` so cross-tenant overwrites fail at the storage layer.

---

## 2. Assets

| #   | Asset                                                                                      | Sensitivity                                 | Why it matters                                                                                                            |
| --- | ------------------------------------------------------------------------------------------ | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| A1  | Tenant entity data (`Company`, `Contact`, `Opportunity`, `Quote`, `Invoice`, `SalesOrder`) | High — competitive intel + commercial terms | Disclosure = direct loss of competitive advantage; a leak across tenants is a contract-termination event                  |
| A2  | Uploaded documents (`FileAttachment` — PDFs, PowerPoints, RFP source)                      | High — IP + potentially malicious           | Document blobs can carry XSS (SVG-with-script), malware (Office macros), and customer-confidential text                   |
| A3  | API keys (`ApiKey`, hashed at rest)                                                        | Critical — programmatic admin power         | A compromised API key can read or mutate the entire tenant slice                                                          |
| A4  | Clerk session JWTs                                                                         | Critical — user impersonation               | Stolen token = full UI session until expiry; SSO-domain restriction (`SSO_ALLOWED_EMAIL_DOMAINS`) limits the blast radius |
| A5  | MCP session tokens (`apps/mcp-server`)                                                     | Critical — agent action authority           | An MCP token can drive automated mutations at machine speed                                                               |
| A6  | Webhook signing secrets (`DUST_WEBHOOK_SECRET`, per-subscription)                          | Critical — replay-attack key                | Compromise enables forged inbound events that mutate state                                                                |
| A7  | Postgres connection string + Redis URL                                                     | Critical — full data tier                   | Direct DB access bypasses every application-layer control                                                                 |
| A8  | Audit log (`AuditLog`)                                                                     | High — forensic ground truth                | Tampering with the audit log breaks incident response                                                                     |
| A9  | Third-party credentials (Dust API key, Apollo, Odoo MCP, Microsoft Graph, Stripe)          | High — billing / data exfil pivot           | Each is a separate revocable trust relationship                                                                           |
| A10 | Source code + CI secrets (GitHub workflow tokens)                                          | High — supply-chain pivot                   | A compromise here writes the next deployment                                                                              |

---

## 3. Threat actors

| Actor                             | Goal                                              | Capability                                                    | Mitigation focus                                                                     |
| --------------------------------- | ------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Opportunistic bot scanner         | Find any public bug for a quick payday            | Mass-scan OWASP Top 10 patterns                               | Defence-in-depth + signal-amplifying gates (rate limit, helmet)                      |
| Targeted external attacker (APT)  | Exfiltrate one specific tenant's deal pipeline    | Slow, low-noise, will burn 0-days                             | Tenant isolation invariants, immutable audit log, anomaly detection                  |
| Malicious tenant insider          | Read across to another tenant's data              | Valid Clerk session on tenant A, attempts cross-tenant access | `orgId` filters on every query; storage-key org prefix; IDOR returns 404 not 403     |
| Compromised vendor / supply-chain | Inject through a npm dep or compromised CI runner | Code execution at build time                                  | `pnpm audit --audit-level high`, semgrep, gitleaks, dep-review action                |
| Rogue employee                    | Cover tracks of unauthorised access or mutation   | Direct DB / S3 access                                         | Audit log on every mutation, Pino redaction, no broad prod DB credentials handed out |
| Phishing / credential-stuffing    | Steal a tenant admin's Clerk credentials          | Reused passwords, social engineering                          | Clerk MFA mandatory in production, SSO domain restriction, short JWT TTL             |

---

## 4. STRIDE per asset

### A1 — Tenant entity data

| Threat                     | Vector                                         | Likelihood | Impact | Control                                                                                                            |
| -------------------------- | ---------------------------------------------- | ---------- | ------ | ------------------------------------------------------------------------------------------------------------------ |
| **S**poofing               | Forged Clerk JWT                               | Low        | High   | Clerk JWKS verification, `verifyToken` with `authorizedParties` (`apps/api/src/plugins/auth.ts`)                   |
| **T**ampering              | Cross-tenant PATCH via guessed UUID            | Med        | High   | Every Prisma `where` filter includes `orgId`; IDOR returns 404 (`opportunities.ts:246`) — pen-test scenario IDOR-1 |
| **R**epudiation            | User denies they moved a deal stage            | Med        | Med    | Atomic `$transaction` on mutation + `AuditLog.create` (`opportunities.ts:373`); audit log is append-only           |
| **I**nformation disclosure | Search payload leaking other tenants' rows     | Low        | High   | Search WHERE clause is `orgId`-scoped (`opportunities.ts:54`) — pen-test scenario IDOR-2                           |
| **D**oS                    | Unbounded list endpoint                        | Med        | Low    | Cursor pagination with `take: limit + 1` cap; Fastify `rateLimit` plugin (`server.ts:208`)                         |
| **E**levation of privilege | Member role escalating to admin via PATCH role | Low        | High   | `requirePermission('settings:write')` gate on `/api/roles/:id` (`roles.ts:128`)                                    |

### A2 — Uploaded documents

| Threat | Vector                                                        | Likelihood | Impact | Control                                                                                                                    |
| ------ | ------------------------------------------------------------- | ---------- | ------ | -------------------------------------------------------------------------------------------------------------------------- |
| **S**  | Forged finalize call referencing another tenant's storage key | Med        | High   | `keyBelongsToOrg(key, orgId)` at finalize + local-upload (`files.ts:130, 150`)                                             |
| **T**  | Upload .svg with `<script>` to XSS the previewer              | High       | Med    | `ALLOWED_FILE_CONTENT_TYPES` is an allow-list, `image/svg+xml` not on it (`schemas/file.ts:10`) — pen-test scenario FILE-1 |
| **R**  | Deletion without trail                                        | Low        | Med    | `file.delete` audit row before deletion (`files.ts:309`)                                                                   |
| **I**  | Direct S3 URL access                                          | Low        | High   | Downloads go through API route, never directly addressable; presigned URLs are time-limited                                |
| **D**  | Upload payload bombs the server                               | Med        | Med    | Fastify `bodyLimit: 10 MiB` global + `FILE_MAX_BYTES = 50 MB` route-specific                                               |
| **E**  | Path traversal via `name=../../etc/passwd`                    | Med        | High   | `safeContentDisposition()` strips control chars (`files.ts:46`); storage layer uses opaque keys never the user's filename  |

### A3 — API keys

| Threat | Vector                                       | Likelihood | Impact   | Control                                                                                                        |
| ------ | -------------------------------------------- | ---------- | -------- | -------------------------------------------------------------------------------------------------------------- |
| **S**  | Key reuse across tenants                     | Low        | Critical | API keys store an Argon2/bcrypt hash, never plaintext after first display                                      |
| **T**  | Use of a revoked key                         | Med        | High     | `ApiKey.revokedAt` checked on every auth path; key lookup is hash-of-presented-secret comparison               |
| **R**  | Action taken via API key with no attribution | Low        | Med      | Audit log records `apiKeyId` alongside `userId`                                                                |
| **I**  | Key in logs                                  | High       | Critical | Pino `redact` paths include `apiKey`, `api_key`, `bearerToken`, `Authorization` (`server.ts:103-117`)          |
| **D**  | Brute-force key guessing                     | Med        | Critical | Rate limit on auth endpoints; cryptographically-random 32-byte keys                                            |
| **E**  | Member-tier key gaining admin scopes         | Low        | Critical | Scopes are set at key-creation time and immutable; PATCH on `/api/api-keys/:id` does not allow scope expansion |

### A4 — Clerk session JWTs

| Threat | Vector                                                  | Likelihood | Impact   | Control                                                                                            |
| ------ | ------------------------------------------------------- | ---------- | -------- | -------------------------------------------------------------------------------------------------- |
| **S**  | Token forged with wrong signing key                     | Low        | Critical | `verifyToken` rejects non-issuer signatures — pen-test scenario AUTH-3                             |
| **T**  | Replay after revocation                                 | Med        | High     | Clerk session check (live revocation propagation); JWT TTL kept short                              |
| **R**  | User claims a different identity than session presented | Low        | Med      | `req.auth.userId` derived from `payload.sub`, used in every audit row                              |
| **I**  | Token in browser localStorage stolen via XSS            | Med        | High     | CSP `script-src 'self'`, `frameAncestors 'none'`, dependency scanning                              |
| **D**  | Token-validation-loop DoS                               | Low        | Low      | `verifyToken` is in-memory, fast; rate-limit per-user key                                          |
| **E**  | Org admin status in token spoofed                       | Low        | Critical | `org_role` mapped through `mapClerkRole()` allow-list, unknown roles `forbidden` (`auth.ts:60-72`) |

### A5 — MCP session tokens

| Threat | Vector                                          | Likelihood | Impact   | Control                                                                       |
| ------ | ----------------------------------------------- | ---------- | -------- | ----------------------------------------------------------------------------- |
| **S**  | Forged session header                           | Low        | Critical | `apps/mcp-server/src/auth.ts` validates session signature                     |
| **T**  | Replay on rate-limited tool                     | Med        | Med      | `apps/mcp-server/src/plugins/hourly-rate-limit.ts` bucket per-key             |
| **R**  | Agent-attributable action without provenance    | Low        | Med      | Every tool call records `apiKeyId` + tool name in audit log                   |
| **I**  | Tool returns cross-tenant data                  | Low        | High     | Every tool wraps a Prisma query that filters by `req.auth.orgId`              |
| **D**  | One agent burst exhausts shared quota           | High       | Med      | Per-key hourly bucket isolates tenants                                        |
| **E**  | A `read` scope tool calling a `write` Prisma op | Med        | Critical | Tool implementations declare required scopes; server enforces before dispatch |

### A6 — Webhook secrets

| Threat | Vector                                             | Likelihood | Impact   | Control                                                                                                                            |
| ------ | -------------------------------------------------- | ---------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **S**  | Forged `X-Dust-Signature`                          | High       | High     | `verifyDustSignature(rawBody, sig, secret)` — pen-test scenario WEBHOOK-1                                                          |
| **T**  | Replay of a captured payload                       | High       | Med      | `MAX_TIMESTAMP_SKEW_MS = 5 min` window + Redis `SET NX` dedup keyed on `x-dust-event-id` — pen-test scenarios WEBHOOK-2, WEBHOOK-3 |
| **R**  | Event processed twice                              | High       | Low      | Dedup as above; idempotent worker processing                                                                                       |
| **I**  | Org metadata in payload doesn't match subscription | Med        | Critical | `extractPayloadOrgMetadata()` + mismatch returns 403 (`webhooks.ts:201-214`)                                                       |
| **D**  | Burst webhook flood                                | Med        | Med      | Route-level `rateLimit: { max: 100, timeWindow: '1 minute' }`                                                                      |
| **E**  | Webhook payload causes tenant-elevated write       | Med        | High     | Worker resolves tenant from subscription row, never from headers (audit P1.3)                                                      |

### A7 — Postgres / Redis

| Threat | Vector                                | Likelihood | Impact   | Control                                                                               |
| ------ | ------------------------------------- | ---------- | -------- | ------------------------------------------------------------------------------------- |
| **S**  | App connects with overprivileged role | Low        | Critical | Per-environment Prisma URL uses a dedicated app role (no `CREATE ROLE` / `SUPERUSER`) |
| **T**  | SQL injection via search              | Low        | Critical | Prisma parameterises every query — pen-test scenario SQLI-1                           |
| **R**  | Direct SQL bypassing audit log        | Low        | High     | Operational access logs all `psql` sessions; runbook requires JIRA-linked ticket      |
| **I**  | Backups written unencrypted           | Low        | Critical | Backup pipeline uses KMS-encrypted snapshots; backup integrity checks in monitoring   |
| **D**  | Connection-pool exhaustion            | Med        | High     | Prisma `connection_limit` per pod; health endpoint surfaces pool saturation           |
| **E**  | Cache key collision between tenants   | Med        | High     | `redisCachePlugin` namespaces keys with `orgId:` prefix                               |

### A8 — Audit log

| Threat | Vector                                                      | Likelihood | Impact   | Control                                                                                        |
| ------ | ----------------------------------------------------------- | ---------- | -------- | ---------------------------------------------------------------------------------------------- |
| **S**  | Rogue actor writes a row attributing action to another user | Med        | High     | `userId` derived from authenticated session, not from request body                             |
| **T**  | Direct UPDATE / DELETE on `audit_log` rows                  | Low        | Critical | Postgres `REVOKE UPDATE, DELETE ON audit_log FROM app_role` (planned — see Residual Risks R-2) |
| **R**  | Action committed without an audit row                       | Med        | High     | `$transaction([mutation, auditLog.create])` pattern in every mutation route                    |
| **I**  | Audit log contains PII it shouldn't                         | Med        | Med      | Diff field is structured JSON; routes serialise only changed fields                            |
| **D**  | Audit log table grows unbounded                             | High       | Med      | Partitioning planned at 100M-row mark (R-3)                                                    |

### A9 — Third-party credentials

| Threat | Vector                                                  | Likelihood | Impact | Control                                                                              |
| ------ | ------------------------------------------------------- | ---------- | ------ | ------------------------------------------------------------------------------------ |
| **S**  | Spoofed third-party API response                        | Med        | Med    | TLS pinning where SDK supports; rate-limited retries                                 |
| **T**  | MITM tampering                                          | Low        | High   | HTTPS-only, HSTS preload, `connectSrc` CSP allow-list (`server.ts:68-77`)            |
| **R**  | Action via third-party not logged locally               | High       | Med    | Worker writes `SyncEvent` row on every received external event                       |
| **I**  | Third-party log retains our PII                         | High       | Med    | Vendor contracts include data-processing addenda; minimal-data principle on outbound |
| **D**  | Vendor outage cascades                                  | High       | Med    | Circuit-breaker pattern on Dust + Odoo clients; degraded-mode fallbacks in UI        |
| **E**  | Vendor-issued token grants broader scopes than intended | Med        | High   | Scope review at each integration onboarding; least-privilege OAuth scopes            |

### A10 — Source code + CI

| Threat | Vector                                              | Likelihood | Impact   | Control                                                                         |
| ------ | --------------------------------------------------- | ---------- | -------- | ------------------------------------------------------------------------------- |
| **S**  | Malicious commit author identity                    | Low        | High     | GitHub-enforced 2FA on org; signed commits encouraged                           |
| **T**  | Force-push to main                                  | Low        | Critical | Branch protection: main requires PR + review + passing checks                   |
| **R**  | Untracked change deployed                           | Low        | High     | All deploys triggered by tagged commits; no manual SSH-and-edit                 |
| **I**  | Secret in commit                                    | High       | Critical | Pre-commit `scripts/check-secrets.sh` + CI `gitleaks` + `secrets-full-scan` job |
| **D**  | CI runner exhaustion via spammed PRs                | Med        | Low      | `concurrency.cancel-in-progress` cancels superseded runs                        |
| **E**  | Workflow `pull_request_target` privilege escalation | Low        | Critical | We use `pull_request` only; `GITHUB_TOKEN` scoped to `contents: read` per job   |

---

## 5. Controls inventory

### 5.1 Existing (verified by `apps/api/src/security/penetration.test.ts`)

| Control                                                       | Where                                                       | Pen-test reference                      |
| ------------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------- |
| Tenant isolation via mandatory `orgId` filter                 | Every Prisma query                                          | IDOR-1, IDOR-2, IDOR-3                  |
| IDOR returns 404 (not 403) to prevent enumeration             | Route handlers throw `notFound` on cross-tenant lookup      | IDOR-1                                  |
| SQL injection defence via Prisma parameterisation             | All routes                                                  | SQLI-1, SQLI-2                          |
| File upload allow-list (no SVG, no exec)                      | `ALLOWED_FILE_CONTENT_TYPES`                                | FILE-1                                  |
| File-size cap before bytes reach storage                      | `FILE_MAX_BYTES`, route-level `bodyLimit`                   | FILE-2                                  |
| Storage-key tenant prefix                                     | `keyBelongsToOrg()` at upload + finalize                    | covered indirectly                      |
| Webhook HMAC verification (constant-time)                     | `verifyDustSignature`                                       | WEBHOOK-1                               |
| Webhook replay window (5 min, Stripe convention)              | `MAX_TIMESTAMP_SKEW_MS`                                     | WEBHOOK-2, WEBHOOK-3                    |
| Webhook event-id dedup (7-day Redis TTL, in-process fallback) | `rememberOrReject()`                                        | WEBHOOK-4 (header)                      |
| Webhook payload org metadata cross-check                      | `extractPayloadOrgMetadata()`                               | webhooks.integration.test.ts            |
| Mass-assignment via Zod schema strip                          | `OpportunityPatch.partial().omit(['orgId', ...])`           | MASS-ASSIGN-1                           |
| RBAC gate on admin endpoints                                  | `requirePermission('settings:read') + requireRole('admin')` | RBAC-1                                  |
| Helmet CSP with `frameAncestors 'none'`, no `unsafe-eval`     | `server.ts:137`                                             | covered by browser tests                |
| Pino redaction of credentials                                 | `server.ts:103-117`                                         | INFO-1 (negative — body not in 500)     |
| Error handler sanitisation                                    | `plugins/error-handler.ts:91-104`                           | INFO-1                                  |
| X-Request-Id on every response                                | `server.ts:133`                                             | INFO-2                                  |
| Rate limit per-user (auth-aware key generator)                | `server.ts:208`                                             | covered by load test                    |
| SSO email-domain allow-list                                   | `SSO_ALLOWED_EMAIL_DOMAINS` env                             | covered by auth.test.ts                 |
| Hashed API keys at rest                                       | `ApiKey` model                                              | covered by api-keys.integration.test.ts |
| Cross-org JIT-provisioning block                              | `auth.ts:151-173`                                           | covered by auth.test.ts                 |
| Audit log row on every mutation in same `$transaction`        | All mutation routes                                         | covered by route integration tests      |
| Pre-commit secret scan                                        | `scripts/check-secrets.sh`                                  | run on every commit                     |
| Full-tree secret scan in CI                                   | `scripts/check-secrets.sh --full`                           | runs on every push + PR                 |
| Gitleaks full-history scan                                    | `.github/workflows/gitleaks.yml`                            | runs on every push + PR                 |
| Semgrep SAST (OWASP Top 10 + TS/JS)                           | `.github/workflows/semgrep.yml`                             | runs on every PR                        |
| Dependency CVE block (CRITICAL/HIGH)                          | `.github/workflows/dependency-review.yml`                   | runs on every PR                        |
| `pnpm audit --audit-level high` release gate                  | `.github/workflows/ci.yml`                                  | runs on every PR                        |

### 5.2 Planned

| Control                                            | Trigger to implement                                                                                 |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| WAF in front of `apps/api`                         | Move to production-load tier (planned with first paying tenant)                                      |
| Postgres role `REVOKE UPDATE, DELETE ON audit_log` | When the audit log moves to a separate logical DB                                                    |
| Audit log partitioning                             | When the table hits 100M rows                                                                        |
| Malware scan on file uploads (ClamAV)              | When `STORAGE_SCAN_REQUIRED=true` is the default; today the flag exists, scanner integration pending |
| Network segmentation between worker + API          | When workers move to a dedicated VPC subnet                                                          |
| Per-tenant encryption-at-rest keys                 | Enterprise tier requirement (PCI / HIPAA discussions)                                                |
| Anomaly detection on access patterns               | When sufficient baseline traffic exists (~6 months of production data)                               |
| Subresource Integrity on third-party scripts       | When we add any third-party `<script src>` (today: zero)                                             |

---

## 6. Residual risks

| ID   | Risk                                                                                                                                         | Severity | Likelihood                | Mitigation plan                                                                                                                                         |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-1  | Pen-test auth-bypass scenarios self-skip in stub-auth mode (dev only); production coverage relies on staging being run with a real Clerk key | Med      | High in dev / Low in prod | Add a staging-targeted run of `penetration.test.ts` with `CLERK_SECRET_KEY` set so the three Clerk scenarios execute pre-release                        |
| R-2  | Audit log can be updated/deleted by the app role today; no DB-level guarantee                                                                | High     | Low                       | Implement `REVOKE UPDATE, DELETE` migration when audit log moves to its own DB; until then, rely on application discipline + access reviews             |
| R-3  | Audit log grows unbounded; no partition strategy at scale                                                                                    | Med      | Med                       | Partition by `month` at 100M-row mark; archive cold partitions to S3                                                                                    |
| R-4  | Local file storage driver in dev mode does not enforce ClamAV scan                                                                           | Low      | Low                       | Dev only — production runs with `STORAGE_DRIVER=s3` + bucket policy enforcing AV scan                                                                   |
| R-5  | In-process webhook dedup fallback (when Redis is unreachable) is per-pod; a multi-pod cluster could process the same event twice             | Med      | Low                       | Already logged at warn level; runbook requires Redis SLA. Acceptable for current single-pod prod                                                        |
| R-6  | Dependency on third-party `verifyToken` (Clerk SDK) — a vulnerable Clerk version would be a supply-chain blast                               | High     | Low                       | `pnpm audit` + Dependabot + dep-review action; subscribe to Clerk security advisories                                                                   |
| R-7  | Audit log diff field may contain PII (e.g. customer name in `opportunity.update`)                                                            | Low      | High                      | Documented as acceptable — diffs are intentional change history. PII-scrubbing on export is the user-facing control                                     |
| R-8  | No formal pen-test by an external firm before public launch                                                                                  | High     | Med                       | Schedule Phase-1 external pen-test with a CREST-certified firm before paid tenants onboard                                                              |
| R-9  | Worker has DB write access; a compromised worker could mutate any tenant                                                                     | Critical | Low                       | Operational: workers run in segregated network; long-term: split Prisma client with `READ_ONLY` mode for the parts of the worker that don't need writes |
| R-10 | No automated detection of secrets pushed to history before this branch (gitleaks runs from now forward; historical scan needed once)         | Med      | Med                       | One-time historical gitleaks scan with results triaged; rotate any keys found                                                                           |

---

## 7. Review cadence

- **Quarterly:** full re-read of this document by the security engineer + tech lead
- **Per change:** any PR touching auth, RBAC, file upload, webhook, payment, or a new third-party integration must reference the threat-model row(s) it affects in the description
- **Per incident:** post-mortem updates the relevant STRIDE row + adds a pen-test scenario for the missed vector
- **Annually:** external pen-test (target: 12 months after first paying tenant)

When this document and the pen-test suite disagree, the suite wins — it's executable. Update this document to match.

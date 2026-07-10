# BidStack 360° — Security Review (Gates 2, 4, 13, 14)

**Date:** 2026-06-28 · **Branch:** feat/prod-hardening-mantu · **Bar:** real production with customer PII (ASVS L2 binding) · **Access:** local repo only (live infra not in scope this session).

**Method:** static + dynamic review on the current tree (5 fused commits + 48 in-flight hardening files). Tooling actually executed this session: `semgrep` (OWASP-Top-Ten + JS + TS, 1568 files), `pnpm audit`, isolated-DB integration suite, build/typecheck, bundle secret + source-map scan. A multi-agent review covered PII-at-rest, CI/CD supply chain, and the full authZ matrix; two agent lanes (frontend, WIP-delta) returned unusable stubs and were redone by hand.

## Summary verdict (security dimension)

Application security is **strong** — multi-tenant org-scoping is pervasive, the RBAC model is DB-authoritative (no admin-claim fallback), SAST is clean, no secrets in repo/bundle/git, and the in-flight WIP _adds_ guards rather than removing any. The prior PII field-encryption trap is now neutralized for supported CRM/KAM PII, and strict PII evidence now fails without storage-encryption proof, a `User.email` storage-only decision owner/reference, and exact plaintext-PII decision scope for SMS/activity/calendar/KAM fields. The security dimension is still **NOT clear-to-ship** for the PII bar until live operator ciphertext evidence and real platform/security evidence values are captured.

---

## Fixed this session (verified: typecheck exit 0)

### [HIGH] Outbound email send had no authorization gate

- **Area / file:** Gate 4 · `apps/api/src/routes/integrations/email.ts:18`
- **Description:** `POST /email/send` had no `preHandler` — any authenticated principal, including a read-only-role user or a **read-scoped API key**, could send email from the org's connected mailbox.
- **Impact:** impersonation, phishing-from-trusted-domain, spam/abuse using the customer's mailbox.
- **Fix implemented:** `preHandler: server.requirePermission('integrations:write')`.
- **Tests added:** none possible without a harness change (see AUTHORIZATION_MATRIX §5); typecheck-verified, canonical pattern.
- **Status:** FIXED · **Residual risk:** low (behavioral 403 test pending harness enhancement).

### [HIGH] Outbound SMS send had no authorization gate

- **Area / file:** Gate 4 · `apps/api/src/routes/integrations/twilio.ts:205`
- **Description:** `POST /sms/send` had no `preHandler` — same exposure as email send, plus direct monetary cost per message.
- **Fix implemented:** `preHandler: fastify.requirePermission('integrations:write')`. Also gated `POST /integrations/twilio/test` (`:179`) with `integrations:read` (was leaking the Twilio account-SID suffix + from-number).
- **Status:** FIXED · **Residual risk:** low.

### [MEDIUM] Org-wide dashboard config writable by any role

- **Area / file:** Gate 4 · `apps/api/src/routes/crm/widgets.ts:18`
- **Description:** `PATCH /crm/widgets` persists the **org-wide** widget layout (orgId-scoped, not per-user) with no gate — any role could rewrite every user's dashboard.
- **Fix implemented:** `preHandler: server.requirePermission('settings:write')`.
- **Status:** FIXED.

### [HIGH, design] REST API-key scopes were resource-agnostic

- **Area / file:** Gate 4 · `apps/api/src/plugins/rbac.ts`, `apps/api/src/lib/api-key-scopes.ts`
- **Description:** REST `requirePermission('<resource>:write')` previously accepted any broad `write` API-key scope, so a leaked write-scoped REST key passed every write gate in the org.
- **Fix implemented:** production REST authorization now accepts exact `PermissionKey` scopes such as `integrations:write`; broad `read`/`write` fallback is restricted to dev/test or an explicit `BIDSTACK_ALLOW_LEGACY_API_KEY_SCOPES=true` migration flag. Production API-key creation rejects broad REST-only keys while still allowing MCP keys to use `mcp` + `read`/`write` tool-class scopes.
- **Tests added:** `apps/api/src/lib/api-key-scopes.test.ts`, `apps/api/src/plugins/rbac.test.ts`.
- **Status:** FIXED for REST production. **Residual risk:** rotate/migrate any existing broad REST keys before production; MCP tool-class scopes remain intentionally separate.

### [MEDIUM] AI compute routes were authenticated-only

- **Area / file:** Gate 4 · `apps/api/src/routes/ai-assistant.ts`, `apps/api/src/routes/calls.read.routes.ts`, `apps/api/src/plugins/rbac.ts`
- **Description:** `POST /ai-assistant/*` and `POST /calls/:id/extract-insights` previously allowed any authenticated principal, including API keys, to trigger LLM/AI compute and CRM data reads.
- **Fix implemented:** added reusable `requireHumanActor`; gated AI assistant compute behind human sessions plus route-specific read permissions (`contacts:read`, `opportunities:read`, `activities:read`, `accounts:read`); gated call re-analysis behind human sessions plus `activities:write`; gated call transcript/recording detail behind `activities:read`; scoped AI feedback to the caller's own session.
- **Tests added:** `apps/api/src/routes/ai-compute-auth.integration.test.ts`; `apps/api/src/plugins/rbac.test.ts`.
- **Status:** FIXED for API-key/human-session boundary. **Residual risk:** product may later choose finer AI entitlements, but there is no longer an authenticated-only AI compute surface.

### [MEDIUM] Twilio inbound SMS retry could 500 after a successful first delivery

- **Area / file:** Gate 10 · `apps/api/src/services/twilio-sms.service.ts`
- **Description:** Twilio retries inbound webhooks when acknowledgement is lost. The handler used a plain `SmsMessage.create`, so a replay for the same `MessageSid` could hit the unique `twilioSid` constraint, return 500, and duplicate downstream CRM activity if retried around side effects.
- **Fix implemented:** inbound SMS now treats `MessageSid` as the idempotency key, catches Prisma `P2002` as already processed, writes activity only after the first successful insert, keeps STOP on `smsConsent.upsert`, selects the integration token by the inbound `To` number, and validates signatures with an explicit Twilio number when available.
- **Tests added:** `apps/api/src/services/twilio-sms.service.test.ts`.
- **Status:** FIXED in code. **Residual risk:** staging should replay a real Twilio webhook with the same `MessageSid` before release evidence is closed.

### [CRITICAL] PII field-encryption trap neutralized for supported models

- **Area / file:** Gate 5/13 · `packages/db/src/middleware/pii-encryption.ts`, `packages/shared/src/crypto/pii-field-cipher.ts`, `scripts/encrypt-existing-pii.ts`, `scripts/decrypt-pii-rollback.ts`
- **Description:** The middleware now rewrites supported encrypted email equality filters to `emailHash`, hashes emails with trim/lowercase canonicalization, decrypts id-only reads when the returned row carries `orgId`, fails loud when it cannot decrypt safely, removes nonexistent `Contact.mobilePhone`, and excludes `User.email` until a generated `User.emailHash` migration exists.
- **Backfill/rollback:** `KamConsultant.email` is now included in forward encryption and rollback; rollback still decrypts legacy encrypted `User.email` rows from the older unsafe implementation.
- **Tests:** `packages/db/src/middleware/pii-encryption.test.ts` covers createMany encryption, fail-loud missing orgId writes/lookups, email equality/in rewrite, KAM id-only read decryption, and User.email exclusion.
- **Status:** FIXED for `Contact`, `Lead`, and `KamConsultant`. **Residual risk:** `User.email` and the SMS/activity/calendar/KAM fields named in the plaintext-PII evidence gate remain plaintext at field level; production still needs operator dry-run/apply evidence, raw ciphertext proof, live storage/User.email/plaintext-PII evidence values, and legal/security sign-off.

---

### [PARTIAL] Tenant isolation backstop added for broad Prisma operations

- **Area / file:** Gate 5 · `packages/db/src/middleware/tenant-scope-guard.ts`, `packages/db/src/index.ts`
- **Description:** `BIDSTACK_TENANT_SCOPE_GUARD=warn|enforce` registers an opt-in Prisma middleware that discovers models with `orgId` and catches broad `findMany`, `count`, `aggregate`, `groupBy`, `updateMany`, and `deleteMany` operations without tenant scope.
- **Tests:** `packages/db/src/middleware/tenant-scope-guard.test.ts` covers enforce/warn behavior, direct `orgId`, `AND`, safe/unsafe `OR`, non-tenant models, and intentionally untouched single-record ownership-resolution paths.
- **Status:** PARTIAL. This is an ORM guard for broad Prisma operations, not DB RLS. Staging must run warn/enforce before production, raw SQL remains manual, and full session-var RLS/design is still open.

---

## Open — CRITICAL

### [CRITICAL] PII-at-rest production certification still incomplete

- **Area / file:** Gate 5/13 · `docs/security/pii-field-encryption.md`, production secret store, production database.
- **Description:** Application field encryption is now safe for `Contact`, `Lead`, and `KamConsultant`, and the strict PII evidence gate now requires storage-level encryption proof plus `User.email` and exact plaintext-PII storage-only decision references.
- **Status:** OPEN · **Owner:** Tony + platform/security · **Residual risk:** HIGH until production evidence proves CRM/KAM ciphertext at rest and the live storage/User.email/plaintext-PII evidence values are captured, or generated field-encryption migrations are added.

---

## Open — HIGH

### [FIXED] PII backfill/rollback omitted KamConsultant → permanent PII loss on rollback

- **File:** `scripts/encrypt-existing-pii.ts:43-184`, `scripts/decrypt-pii-rollback.ts:40-174`
- **Description:** The middleware encrypts `KamConsultant.email`, but neither the backfill nor the rollback script processed that model. On rollback the master key could be archived per the runbook → those rows would decrypt to a mask = unrecoverable.
- **Fix:** `KamConsultant` is now processed by both scripts; legacy encrypted `User.email` rows remain rollback-only for recovery. **Status:** FIXED.

### [FIXED] PII read decryption skipped when orgId absent → ciphertext returned to callers

- **File:** `packages/db/src/middleware/pii-encryption.ts:283-316`
- **Description:** `decryptResult` previously ran only when `extractOrgId(args)` was truthy. An id-only read could return the raw `enc:v1` envelope instead of plaintext.
- **Fix:** read decryption now uses the returned row's `orgId` when the query lacks one and throws instead of returning an encrypted value without enough context. **Status:** FIXED for reads; PII writes still require `orgId` in data/where and fail loud otherwise.

### [HIGH] Supply-chain / CI gates not enforced (Gate 8)

- **Files:** `.github/workflows/*`
- **Description:** Container image vulnerability scanning exists only as a script (`pnpm container:scan`), not enforced in CI; there is no CD/release workflow with a production-deploy approval gate in the repo; third-party actions + the Semgrep image are pinned to **mutable tags, not commit SHAs** (supply-chain tamper risk). Secondary: IaC scan not in CI, no license gate, 4 workflows lack a top-level least-privilege `permissions:` block, no Dependabot/Renovate, no SBOM/provenance/signing.
- **Fix:** add container-scan + IaC-scan jobs to CI as required checks; pin actions/images by SHA; add a gated CD workflow; add `permissions: {}` defaults; enable Dependabot; emit SBOM + provenance. **Status:** OPEN (most need CI/repo-admin access to verify).

---

## Open — MEDIUM / LOW (selected)

- **[MEDIUM]** Product may still introduce finer AI entitlements/quotas, but the prior authenticated-only AI compute surfaces are now gated; no open Gate 4 AI-compute blocker remains from this review.
- **[MEDIUM]** `User.email @unique @db.Citext` is intentionally excluded from field encryption until a generated `User.emailHash` migration and certified lookup path exist.
- **[MEDIUM]** PII decrypt failure is fully silent (returns mask) — a wrong/rotated master key would mask all PII reads with no alert. Add a rate-limited error/metric + startup self-test. `pii-field-cipher.ts:109-140`.
- **[FIXED]** Phantom `Contact.mobilePhone` was removed from `PII_MAP` and the PII runbook erasure SQL.
- **[LOW]** Railway image `apps/api/Dockerfile` runs as **root** + `--no-frozen-lockfile` (demo-only) — real prod must use the root `Dockerfile` non-root `api` target.
- **[LOW]** Prod web build must use `BIDSTACK_WEB_BUILD_MODE=clerk` (demo mode stores a token in `localStorage`; Clerk path uses httpOnly).
- **[LOW]** Base images tag-pinned (`node:24-alpine`), not digest-pinned.

---

## Verified strong (evidence)

- **SAST:** semgrep OWASP-Top-Ten + JS + TS, 1568 files, **0 findings** (`production-readiness/evidence/2026-06-28/semgrep-sast.log`, `deploy-evidence/semgrep-latest.json`).
- **SCA:** `pnpm audit` → 0 high/critical, 1 moderate.
- **Secrets:** `.env` + `.vercel/.env.production.local` gitignored **and untracked**; 0 secrets in the web bundle; 0 source maps in the prod bundle.
- **Multi-tenancy / authZ:** 233/313 mutation routes guarded; WIP net guard + org-scope counts equal-or-higher than HEAD (no regression); RBAC DB-authoritative, API-role rejected from role gates.
- **XSS:** single `dangerouslySetInnerHTML` is `DOMPurify.sanitize()`-wrapped; no `eval`/`Function` ctor in the web app.
- **Merge safety:** the two new delete actions (opportunity, proposal) are `requirePermission`-gated, org-scoped, audited, soft-delete.

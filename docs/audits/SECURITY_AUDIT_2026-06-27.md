# Security Audit — 2026-06-27

**Scope:** Multi-tenant data isolation, authZ/RBAC/IDOR, injection/validation/SSRF, secret/PII leakage.
**Method:** Four independent read-only reviewers traced the actual code (≈800+ tenant query sites, 278 mutation routes, all `$queryRaw`/`$executeRaw` sites, outbound-fetch surfaces, frontend env usage). Skeptical, evidence-based; conventions accounted for (reads are intentionally not permission-gated; writes require `X:write`; org-scoping is manual-per-query).

**Overall:** Isolation, auth plugins, injection defenses and PII-at-rest discipline are **strong**. One genuine cross-tenant read, a cluster of missing write-gates, and two API-side SSRF gaps were the material findings. All but the SSRF cluster and one ops check are fixed in this pass.

---

## Fixed in this pass (commits on `feat/prod-hardening-mantu`)

| # | Sev | Area | File | Fix |
|---|-----|------|------|-----|
| 1 | MAJOR (cross-tenant) | Isolation | `routes/references.ts` POST | `companyId` from request body was stored without an org-ownership check → could link (and leak via the GET include) another org's company name/logo. Added `tenantEntityBelongsToOrg('company', …)` guard (mirrors `proposals.ts`). |
| 2 | MAJOR | AuthZ | `routes/dust-integration.ts` `POST /dust/push-deal/:id` | Added `requirePermission('integrations:write')` (every sibling was gated). |
| 3 | MAJOR | AuthZ | `routes/migrations-hubspot.routes.ts` `POST /migrations/start-hubspot` | Added `requirePermission('settings:write')` (bulk import had no RBAC gate). |
| 4 | MAJOR | AuthZ | `routes/onboarding.ts` install + `DELETE /sample-data` | Added `requirePermission('settings:write')` (mass create/wipe was ungated). |
| 5 | MAJOR | AuthZ | `routes/calls.write.routes.ts` quick-start + schedule | Added `requirePermission('activities:write')` (creates calls + spends provider money). |
| 6 | MAJOR | AuthZ | `routes/cs.ts` churn-signal acknowledge + resolve | Added `requirePermission('accounts:write')`. |
| 7 | MAJOR | AuthZ (horizontal) | `routes/bookings-pages.ts` `PUT /:id` | Scoped the lookup to the owner (`userId`), not just `orgId` — any member could edit a colleague's booking page (availability / redirect → phishing). |

Each MAJOR authZ gap let a **Read-Only role member AND a read-scoped API key** perform the write (the rbac scope-check only runs when a `requirePermission` gate is present).

---

## Remaining — tracked, not yet fixed

### SSRF parity (MAJOR) — next implementation step
Two **authenticated, rate-limited** API-side paths fetch a tenant-controlled URL after only a *string-level* host check (no DNS resolution), so a hostname that resolves to an internal/metadata IP (DNS-rebind) passes:
- `routes/webhook-subscriptions.ts:337` — `POST /webhook-subscriptions/:id/test`
- `routes/dust-integration.helpers.ts:216` — integration endpoint probe

**Fix (one root cause):** promote the worker's DNS-resolving `createResearchFetch` (`apps/worker/src/lib/safe-research-fetch.ts`) into `@bidstack/shared` and use it for every API-side fetch of a tenant URL. The code already names this as the intended follow-up. `apps/worker/src/queues/webhook-delivery.ts` is the reference implementation (already DNS-safe).
- Also verify `services/documents/signature.service.ts:200` — `fetch(doc.storageUrl)` — confirm `storageUrl` is exclusively server-minted (S3); if tenant-influenced, it's a read-SSRF.

### Operational verification (MAJOR) — handoff to Tony
- `PII_FIELD_ENCRYPTION` gates the entire PII-at-rest middleware and **defaults to `false`**. Confirm production has `PII_FIELD_ENCRYPTION=true` and `PII_ENCRYPTION_MASTER_KEY` set (after running `scripts/encrypt-existing-pii.ts`). If not set in prod, Contact/Lead/User email+phone are stored in plaintext. **This is the single highest-impact check and cannot be verified from code.**

### Hardening / defense-in-depth (MINOR)
- `routes/proposals.ts:141` — analytics join not org-filtered (`LEFT JOIN opportunities` lacks `AND o.org_id`); not exploitable today, make explicit.
- `routes/activities.ts:234` — `findUniqueOrThrow({ where: { id } })` server-minted id; add `orgId` to match convention.
- `routes/predictive.ts` — `targetId` not in-org-validated for `churn_risk`/`lead_score` kinds.
- `routes/track.ts:80,131` — `emailMessage.updateMany` add explicit `orgId`.
- `routes/integrations/email.ts:127` — `integrationToken.findMany` has no `select`, pulling `*Encrypted` tokens into memory; add `select`.
- Tighten permissive `z.any()`/`z.record(z.unknown())` **response** schemas (`audit-logs.ts:100`, `opportunities.export.ts:71`, `erp-integration.ts`, `cs.ts`) so a future sensitive column can't silently serialize.
- `routes/help.ts:21` — feedback POST writes an auditLog with no rate limit (table spam).
- `routes/ops-sentry-smoke.ts` — public POSTs reachable; ensure not registered in production.
- AI/LLM-spend POSTs (`ai-assistant.ts`, `calls extract-insights`) are ungated by design — document or add an `ai:use` gate.

### Accepted design (DPIA-flag)
- `CallSession.transcriptText` / `KamSession.transcriptText`+`attendees` are plaintext PII at rest (outside the scalar PII middleware). Access-scoped + audited (`docs/solutions/kam-pii.md`); confirm it's a signed-off DPIA decision; consider app-layer encryption if the threat model includes a raw DB dump.

### Structural recommendation (ADR)
Org-scoping is **100% manual per query** — there is no RLS or tenant-scoped Prisma extension; isolation rests on every handler remembering `where: { orgId }`. At 100k users this is fragile (one missed clause leaks). Recommend an ADR to add a tenant-scoped Prisma client extension (or Postgres RLS) so a missed scope **fails closed** rather than leaking. Out of scope for this pass; high-value durability investment.

---

## Verified strong (no action)
- **Auth plugins:** stub auth triple-fenced (no `CLERK_SECRET_KEY` + dev/test NODE_ENV + loopback IP); E2E role headers env-flag + loopback gated; no admin-claim fallback (DB authorizes); demo-auth HMAC `timingSafeEqual` + per-visitor org isolation.
- **IDOR:** zero bare `findUnique({ where: { id } })` mutations — every by-id write uses an org-scoped pre-check or `updateMany({ where: { id, orgId } })`.
- **Injection:** all `$queryRaw`/`$executeRaw` parameterized + org-scoped; the dynamic analytics report builder (`lib/analytics-engine.ts`) resolves identifiers from a static allowlist and binds all values — reference quality. No SQLi.
- **Stored XSS:** the only `dangerouslySetInnerHTML` wraps `DOMPurify.sanitize`.
- **Secrets:** frontend uses only public `VITE_*` vars (no private keys); pino `redact` removes credentials from logs; error-handler returns generic 5xx (no stack/SQL leak); secrets encrypted at rest, returned only masked/once-at-creation.

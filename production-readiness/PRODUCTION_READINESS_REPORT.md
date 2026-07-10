# BidStack 360° — Production Readiness Report

**Date:** 2026-07-01 · **Branch:** feat/prod-hardening-mantu
**Bar:** real production with customer PII · **Access this session:** local repo only.
**Method:** evidence-based. Unverified = UNKNOWN/FAIL, never assumed PASS. Supersedes 2026-06-27.

---

## 1. Verdict: **NOT READY**

The application/code layer is **strong and improved this session**; the remaining gap is **PII/webhook production evidence plus operational verification that requires cloud/staging access** — not broad application defects.

## 2. Top risks (highest first)

1. **PII/webhook at-rest certification remains open (CRITICAL, Gate 5/13).** The PII code trap is fixed for `Contact`, `Lead`, and `KamConsultant` by routing supported email equality filters through keyed `emailHash`, covering KAM backfill/rollback, and failing loud when decryption context is missing. Webhook delivery now uses strict `decryptWebhookSigningSecret`; inbound Dust webhook org resolution uses keyed `WebhookSubscription.secretHash` in production-like runtimes instead of plaintext secret equality. Legacy plaintext or missing/invalid secret hashes require `scripts/encrypt-webhook-secrets.ts` and cannot pass release evidence. `pnpm deploy:evidence:pii` and `pnpm deploy:evidence:webhooks` now write privacy-safe raw DB proof artifacts and are wired into the strict bundle/verifier; strict PII evidence also requires storage-encryption proof, a `User.email` storage-only decision owner/reference, and exact plaintext-PII decision scope for SMS/activity/calendar/KAM fields. Production still needs operator dry-run/apply evidence and live release DB ciphertext/hash artifacts populated with real platform/security evidence values.
2. **Live infra/IAM/network unverified (HIGH, Gate 6).** No cloud IAM least-privilege, bucket/DB exposure, DNS/TLS, firewall review.
3. **Production backup/restore unverified (HIGH, Gate 12).** The restore _mechanism_ is now proven locally (dump→restore→row-count match), and staging/production migrations now fail closed without fresh encrypted pre-migrate backup proof. Actual prod backup existence/offsite/immutability + a prod restore drill + RTO/RPO remain unverified.
4. **Performance under load unmeasured (HIGH, Gate 10).** k6 scripts exist; no run.
5. **Supply-chain CI gates not fully enforced (HIGH, Gate 8).** SAST + SCA run clean this session, strict container evidence now requires raw Trivy JSON plus CycloneDX SBOM JSON per image, and strict release evidence now requires compact proof of 10 consecutive full-suite CI runs tied to the exact release commit/branch. Live container/IaC scans still are not required CI checks, there's no gated CD, actions use mutable tags, and the real CI repeat artifact has not been exported.
6. **Runtime API/MCP proof still needs live targets (MEDIUM, Gate 4).** The code now has API/MCP connectivity evidence commands, including a privacy-safe no-match REST domain read smoke and a privacy-safe read-only MCP `tools/call` smoke, but staging/production target+token runs have not been captured.

## 3. What was fixed this session (committed `06c33a59`)

Four authorization gaps (Gate 4), all reachable by read-only roles + read-scoped API keys:

- `POST /email/send` → `integrations:write` (send from org mailbox)
- `POST /sms/send` → `integrations:write` (SMS cost + abuse)
- `POST /integrations/twilio/test` → `integrations:read` (leaked Twilio config)
- `PATCH /crm/widgets` → `settings:write` (org-wide dashboard config)

Verified: `pnpm --filter @bidstack/api typecheck` exit 0; full api suite 809 passed with the fixes in place.

## 4. What was verified this session (fresh evidence — see `EVIDENCE_INDEX.md`)

- typecheck (all packages) ✅ · prod build ✅ · mcp 54/54 ✅ · shared 149/149 ✅
- SAST: semgrep OWASP/JS/TS, **0 findings / 1568 files** ✅
- SCA: `pnpm audit` **0 high/critical** (1 moderate) ✅
- Secrets: `.env` + `.vercel/.env.production.local` gitignored & untracked; **0 secrets in web bundle; 0 source maps** ✅
- Backup/restore mechanism: dump→restore→**row-count match** ✅
- Migration safety: staging/production `db:migrate:deploy` and Docker `migrate` target require fresh encrypted pre-migrate backup proof ✅
- AuthZ matrix: prior AI-compute gaps now gated behind human sessions + route permissions ✅
- REST API-key exact production scopes: focused auth tests pass ✅
- AI compute API-key denial: focused auth tests pass ✅
- Public booking + e-signature E2E: blank fixture env values now fall back to seeded defaults; missing booking/signing fixtures and missing send-for-signature UI are hard failures; focused Chromium gate passed 8/8 ✅
- Signed-document PDF renderer runtime: API Docker image builds with Chromium, exposes `PUPPETEER_EXECUTABLE_PATH`, and runtime probe confirms executable Chromium ✅
- Container evidence contract: scanner/verifier selftests prove strict release evidence requires immutable refs, raw Trivy JSON, CycloneDX SBOM JSON, zero blocking findings, and full deploy-image coverage ✅
- KAM handoff UI: KAM cockpit now exposes draft/exported/confirmed OM handoffs, downloads the ABC OM JSON payload, previews the exported payload, and requires an ABC reference before confirmation ✅
- A11y + cross-browser local proof: strict `deploy:evidence:a11y` writer/verifier/bundle step added and selftested; local Chromium a11y diagnostic passed 43/43; full local Firefox/WebKit E2E passed 123/123 with 9 intentional Clerk-mode skips after fixing cockpit missing-field rendering, quick-add dialog/listbox semantics, and settings-save browser races ✅
- Webhook secret lookup hash: new subscription writes store encrypted secret plus keyed `secretHash`; production-like inbound Dust rejects legacy plaintext subscription lookup; backfill/evidence/verifier selftests require valid hashes ✅
- MCP connectivity gate: `deploy:evidence:mcp` now accepts the server's object-shaped discovery metadata, requires `tools/list`, runs a default no-match `crm_search_companies` `tools/call`, and stores only counts/privacy flags instead of raw tool output ✅
- API connectivity gate: `deploy:evidence:api` now goes beyond health/auth and requires a privacy-safe no-match `GET /api/companies` domain read smoke, storing only status/path/shape/item-count flags ✅
- Twilio inbound SMS idempotency: provider retries for the same `MessageSid` now return cleanly without duplicating CRM activity; inbound token selection and signature validation can use the concrete Twilio number; focused service tests cover first delivery, duplicate retry, STOP consent, and explicit-number signature behavior ✅
- Outbound communication caps: email/SMS sends now reserve Redis-backed daily user/org volume before provider egress; SMS also reserves estimated segment spend, and production fails closed if Redis-backed caps are unavailable ✅
- Provider-call timeouts: Gmail/Google, Microsoft Graph, Slack, Twilio, and OAuth token/profile fetches now use shared bounded timeouts and known provider timeouts serialize as HTTP 504 instead of generic 500s ✅
- OAuth refresh lock: Gmail and Microsoft Graph refreshes now use Redis-backed per-token single-flight, so concurrent waiters reuse the saved access token instead of racing provider refresh-token rotation ✅
- CSP single source: Helmet CSP is disabled, `securityHeadersPlugin` owns the effective CSP/Permissions-Policy, and focused Fastify tests prove the response header matches the shared builder ✅
- Tenant-scope guard: opt-in Prisma middleware now warns/enforces on broad tenant-model `findMany`/`count`/`aggregate`/`groupBy`/`updateMany`/`deleteMany` operations that lack `orgId`; focused DB middleware tests/typecheck/build/lint pass ✅
- Telemetry privacy scrub: Fastify/Pino request URLs, query strings, generic log args, and Sentry
  request/exception/breadcrumb payloads now redact emails, phone-shaped values, sensitive field names,
  and token-shaped strings ✅
- Sentry smoke evidence gate: strict release evidence now requires API and worker smoke issue queries scoped to
  the exact release/environment/project, plus privacy flags proving no raw event payloads, stack traces, request
  bodies, user emails, or raw command output are stored ✅
- CI repeat evidence gate: `deploy:evidence:ci` now writes compact 10-run proof, the bundle requires it, and the strict verifier rejects wrong commit/branch, skipped/failed suites, non-isolated or non-pgvector CI, and artifacts containing raw logs, command output, provider payloads, or secrets ✅
- Full local workspace tests: root `pnpm test` passes on 2026-07-01 after rebuilding `@bidstack/db`; API package summary is 127 files / 861 tests passed. The fix also covers RBAC decision-cache test isolation, seeded `agents:read` / `agents:write` permissions for Crew/Agent Studio routes, and a new `pnpm test:hermeticity` guard that fails on shared `org_seed_mantu` API-test regressions.
- WIP-delta (48 files): **no security regression** — net guards + org-scoping equal-or-higher ✅
- Merge safety: the 2 fused delete actions are gated + org-scoped + audited + soft-delete ✅
- QA: 4 clean isolated api runs green; flakiness traced to self-inflicted contention ✅

## 5. Remaining findings / open items

- **CRITICAL:** PII + webhook operator dry-run/apply evidence, live `deploy:evidence:pii` and `deploy:evidence:webhooks` release DB ciphertext/hash artifacts, real storage-encryption proof, `User.email` storage-only decision evidence, and exact plaintext-PII storage-only decision evidence for SMS/activity/calendar/KAM fields.
- **HIGH:** live container/SBOM + IaC scans enforced in CI, live `deploy:evidence:ci` artifact exported from the real CI provider, gated CD approval, action SHA pinning.
- **MEDIUM:** silent decrypt-mask startup self-test; live Sentry/dashboard alert paging proof; optional finer AI entitlement/quotas beyond the new human-session + permission gates.
- **MEDIUM:** tenant-scope guard needs staging `warn` sweep, intentional maintenance-query rewrites, `enforce` rollout, and a DB RLS/session-context decision for the final backstop.
- **Gate 9:** full local root `pnpm test` now passes, including API 127 files / 861 tests, and starts with `pnpm test:hermeticity` to prevent shared seed-org regressions; targeted public booking/e-signature browser gate is green; full local Firefox/WebKit E2E passed 123/123 with 9 intentional Clerk-mode skips. Still needs a live `deploy:evidence:ci` artifact exported from isolated pgvector-enabled CI, live strict browser/a11y artifacts, and broader lifecycle coverage.
- **Gate 3:** local a11y/cross-browser proof is materially improved, but strict release artifacts still require a non-local Clerk-backed target and production build evidence; Apple-UX/manual responsive review remains open.

## 6. Required human approvals / access (to close the gates)

1. **Cloud + CI read access + authorized-testing scope** (domains, accounts, environments) — unblocks Gates 6, 7, 8, 9, 10.
2. **PII/webhook production evidence + decision:** run/apply `scripts/encrypt-existing-pii.ts` and `scripts/encrypt-webhook-secrets.ts`, run `pnpm deploy:evidence:pii` and `pnpm deploy:evidence:webhooks` against the release DB, and supply storage-level encryption plus `BIDSTACK_USER_EMAIL_AT_REST_DECISION=storage-encryption-only` and `BIDSTACK_PLAINTEXT_PII_AT_REST_DECISION=storage-encryption-only` owner/reference/scope evidence. If the decision is field encryption, add the generated schema/migration and certified lookup path first.
3. **Production backup + restore drill** in staging; generate a real pre-migrate backup proof artifact; ratify RTO/RPO.
4. **Legal/security sign-off** for any compliance claim (Gate 13 is an evidence package only).

## 7. 30 / 60 / 90-day hardening plan

**0-30 (blockers):** run PII backfill + `deploy:evidence:pii` with storage/User.email evidence, run webhook secret backfill + `deploy:evidence:webhooks`; generate real pre-migrate backup proof, run prod backup/restore + rollback drills (RTO/RPO); live IAM/network/TLS/bucket review; run strict container vuln/SBOM evidence on immutable release image digests, enforce container + IaC scans in CI + a gated CD; run k6 load at expected traffic.
**30–60 (HIGH/MED):** rotate/migrate any legacy broad REST API keys to exact scopes; export the real 10-run CI series and run `pnpm deploy:evidence:ci`; run strict live a11y + browser E2E artifacts against a non-local Clerk-backed target; runtime dashboards/alerts validated (trigger test alerts); run `BIDSTACK_TENANT_SCOPE_GUARD=warn` in staging, clean/accept intentional broad scans, then promote `enforce`; decide final DB RLS/session-context design; decide whether to add a dedicated AI entitlement beyond the current human-session + permission gates.
**60–90 (hardening):** provenance attestations + action SHA-pinning + Dependabot; DR tabletop; vendor/subprocessor review; web unit-coverage uplift; soak tests + capacity plan.

# BidStack 360° — Production Readiness Report

**Date:** 2026-06-28 · **Branch:** feat/prod-hardening-mantu
**Bar:** real production with customer PII · **Access this session:** local repo only.
**Method:** evidence-based. Unverified = UNKNOWN/FAIL, never assumed PASS. Supersedes 2026-06-27.

---

## 1. Verdict: **NOT READY**

The application/code layer is **strong and improved this session**; the remaining gap is **PII/webhook production evidence plus operational verification that requires cloud/staging access** — not broad application defects.

## 2. Top risks (highest first)

1. **PII/webhook at-rest certification remains open (CRITICAL, Gate 5/13).** The PII code trap is fixed for `Contact`, `Lead`, and `KamConsultant` by routing supported email equality filters through keyed `emailHash`, covering KAM backfill/rollback, and failing loud when decryption context is missing. Webhook delivery now uses strict `decryptWebhookSigningSecret`; inbound Dust webhook org resolution uses keyed `WebhookSubscription.secretHash` in production-like runtimes instead of plaintext secret equality. Legacy plaintext or missing/invalid secret hashes require `scripts/encrypt-webhook-secrets.ts` and cannot pass release evidence. `pnpm deploy:evidence:pii` and `pnpm deploy:evidence:webhooks` now write privacy-safe raw DB proof artifacts and are wired into the strict bundle/verifier. Production still needs operator dry-run/apply evidence, live release DB ciphertext/hash artifacts, storage-level encryption confirmation, and a decision/control for `User.email` (currently excluded from field encryption until a generated `User.emailHash` migration exists).
2. **Live infra/IAM/network unverified (HIGH, Gate 6).** No cloud IAM least-privilege, bucket/DB exposure, DNS/TLS, firewall review.
3. **Production backup/restore unverified (HIGH, Gate 12).** The restore _mechanism_ is now proven locally (dump→restore→row-count match), and staging/production migrations now fail closed without fresh encrypted pre-migrate backup proof. Actual prod backup existence/offsite/immutability + a prod restore drill + RTO/RPO remain unverified.
4. **Performance under load unmeasured (HIGH, Gate 10).** k6 scripts exist; no run.
5. **Supply-chain CI gates not enforced (HIGH, Gate 8).** SAST + SCA run clean this session, and strict container evidence now requires raw Trivy JSON plus CycloneDX SBOM JSON per image, but live container/IaC scans still are not required CI checks, there's no gated CD, and actions use mutable tags.
6. **Runtime API/MCP proof still needs live targets (MEDIUM, Gate 4).** The code now has API/MCP connectivity evidence commands, including a privacy-safe read-only MCP `tools/call` smoke, but staging/production target+token runs have not been captured.

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
- Webhook secret lookup hash: new subscription writes store encrypted secret plus keyed `secretHash`; production-like inbound Dust rejects legacy plaintext subscription lookup; backfill/evidence/verifier selftests require valid hashes ✅
- MCP connectivity gate: `deploy:evidence:mcp` now accepts the server's object-shaped discovery metadata, requires `tools/list`, runs a default no-match `crm_search_companies` `tools/call`, and stores only counts/privacy flags instead of raw tool output ✅
- Telemetry privacy scrub: Fastify/Pino request URLs, query strings, generic log args, and Sentry
  request/exception/breadcrumb payloads now redact emails, phone-shaped values, sensitive field names,
  and token-shaped strings ✅
- WIP-delta (48 files): **no security regression** — net guards + org-scoping equal-or-higher ✅
- Merge safety: the 2 fused delete actions are gated + org-scoped + audited + soft-delete ✅
- QA: 4 clean isolated api runs green; flakiness traced to self-inflicted contention ✅

## 5. Remaining findings / open items

- **CRITICAL:** PII + webhook operator dry-run/apply evidence, live `deploy:evidence:pii` and `deploy:evidence:webhooks` release DB ciphertext/hash artifacts, storage-level encryption confirmation, and `User.email` field-level decision.
- **HIGH:** live container/SBOM + IaC scans enforced in CI, gated CD approval, action SHA pinning.
- **MEDIUM:** silent decrypt-mask startup self-test; optional finer AI entitlement/quotas beyond the new human-session + permission gates.
- **Gate 9:** full local API suite now passes after route-test isolation and the targeted public booking/e-signature browser gate is green; still needs CI repeat proof on isolated infra (for example 10x green) and broader lifecycle coverage.
- **Gate 3:** a11y (WCAG 2.2 AA) + full cross-browser E2E + Apple-UX review remain open.

## 6. Required human approvals / access (to close the gates)

1. **Cloud + CI read access + authorized-testing scope** (domains, accounts, environments) — unblocks Gates 6, 7, 8, 10.
2. **PII/webhook production evidence + decision:** run/apply `scripts/encrypt-existing-pii.ts` and `scripts/encrypt-webhook-secrets.ts`, run `pnpm deploy:evidence:pii` and `pnpm deploy:evidence:webhooks` against the release DB, confirm storage-level encryption, and decide whether `User.email` is storage-encryption-only or gets a generated `User.emailHash` migration.
3. **Production backup + restore drill** in staging; generate a real pre-migrate backup proof artifact; ratify RTO/RPO.
4. **Legal/security sign-off** for any compliance claim (Gate 13 is an evidence package only).

## 7. 30 / 60 / 90-day hardening plan

**0–30 (blockers):** run PII backfill + `deploy:evidence:pii`, run webhook secret backfill + `deploy:evidence:webhooks`, confirm storage encryption, decide `User.email`; generate real pre-migrate backup proof, run prod backup/restore + rollback drills (RTO/RPO); live IAM/network/TLS/bucket review; run strict container vuln/SBOM evidence on immutable release image digests, enforce container + IaC scans in CI + a gated CD; run k6 load at expected traffic.
**30–60 (HIGH/MED):** rotate/migrate any legacy broad REST API keys to exact scopes; prove 10x green in CI; a11y (WCAG 2.2 AA) + browser E2E; runtime dashboards/alerts validated (trigger test alerts); RLS/Prisma-extension tenant backstop ADR; decide whether to add a dedicated AI entitlement beyond the current human-session + permission gates.
**60–90 (hardening):** provenance attestations + action SHA-pinning + Dependabot; DR tabletop; vendor/subprocessor review; web unit-coverage uplift; soak tests + capacity plan.

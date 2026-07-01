# BidStack 360° — Evidence Index

**Session:** 2026-06-28/29 · **Branch:** feat/prod-hardening-mantu · **Access:** local repo only.

Raw command output for this session is under `production-readiness/evidence/2026-06-28/` and
`production-readiness/evidence/2026-06-29/`.

## Command-output evidence (this session)

| Evidence                      | File                                                                           | Proves                                                                                                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Typecheck (all packages)      | `evidence/2026-06-28/typecheck.log` (exit 0)                                   | Gate 4/9 — type safety on current tree                                                                                                                                          |
| Production build (all apps)   | `evidence/2026-06-28/build.log` (exit 0)                                       | Gate 3/9 — buildable artifacts                                                                                                                                                  |
| Unit (mcp 54, shared 149)     | `evidence/2026-06-28/unit-nondb.log`                                           | Gate 9 — non-DB unit suites                                                                                                                                                     |
| SAST (semgrep)                | `evidence/2026-06-28/semgrep-sast.log` + `deploy-evidence/semgrep-latest.json` | Gate 8 — 0 findings / 1568 files (OWASP Top 10)                                                                                                                                 |
| Dependency audit              | `pnpm audit` (inline)                                                          | Gate 8 — 0 high/critical                                                                                                                                                        |
| API integration suite         | `evidence/2026-06-28/api-suite-run{1,3,4}.log` (clean, 808 pass)               | Gate 9 — green when isolated                                                                                                                                                    |
| API suite flakiness analysis  | `evidence/2026-06-28/api-suite-run2.log`, `api-suite-clean-runs.summary`       | Gate 9 — failures traced to contention                                                                                                                                          |
| Backup/restore drill          | `evidence/2026-06-28/backup-restore-drill.log`                                 | Gate 12 — restore _mechanism_ validated locally                                                                                                                                 |
| PII evidence gate selftests   | `evidence/2026-06-28/pii-evidence-gates.log`                                   | Gate 5/13 — `deploy:evidence:pii`, strict verifier, and bundle selftests pass; live DB artifact still required                                                                  |
| Webhook secret gate selftests | `evidence/2026-06-28/webhook-secret-evidence-gates.log`                        | Gate 5 — webhook backfill, `deploy:evidence:webhooks`, strict verifier, and bundle selftests pass; live DB artifact still required                                              |
| Telemetry privacy scrub gates | `evidence/2026-06-29/telemetry-privacy-scrub-gates.log`                        | Gate 11/13 — Fastify/Pino and Sentry scrub emails, phones, query-string PII, and token-shaped strings before telemetry leaves process                                           |
| Migration backup guard gates  | `evidence/2026-06-29/migration-backup-guard-gates.log`                         | Gate 12 — staging/production migrations fail closed without fresh encrypted pre-migrate backup proof tied to `DATABASE_URL`                                                     |
| Public-flow E2E hardening     | `evidence/2026-06-29/e2e-public-flows-hardening-gates.log`                     | Gate 3/9 — public booking and e-signature browser flows hard-fail on missing fixtures/UI and pass 8/8 on Chromium                                                               |
| PDF renderer runtime gates    | `evidence/2026-06-29/pdf-renderer-runtime-gates.log`                           | Gate 7/9 — API Docker image builds with Chromium, exposes Puppeteer path, and runtime probe confirms executable Chromium                                                        |
| Container SBOM gate hardening | `evidence/2026-06-29/container-sbom-gate-hardening.log`                        | Gate 7/8 — strict container evidence selftests require raw Trivy vuln JSON + CycloneDX SBOM JSON per immutable image                                                            |
| KAM handoff UI gates          | `evidence/2026-06-29/kam-handoff-ui-gates.log`                                 | Gate 3/9 — KAM cockpit exposes ABC OM handoff export/confirm UI with focused test/typecheck/lint/build proof                                                                    |
| A11y release evidence gates   | `evidence/2026-06-29/a11y-release-evidence-gates.log`                          | Gate 3/9 - strict a11y gate added/selftested; local Chromium a11y passed 43/43; local Firefox/WebKit E2E passed 123/123 with 9 intentional Clerk-mode skips                     |
| Webhook secret hash gates     | `evidence/2026-06-29/webhook-secret-hash-gates.log`                            | Gate 5/13 — webhook subscriptions use keyed lookup hashes; strict evidence rejects missing/invalid hashes                                                                       |
| API domain smoke gates        | `evidence/2026-06-29/api-domain-smoke-gates.log`                               | Gate 4 - API strict evidence requires health, auth context, and a privacy-safe no-match `/api/companies` read smoke                                                             |
| Twilio inbound idempotency    | `evidence/2026-06-29/twilio-inbound-idempotency-gates.log`                     | Gate 10 - inbound SMS retries for the same `MessageSid` are handled without duplicate CRM activity or retry-storm 500s; signature validation can use the explicit Twilio number |
| Outbound communication caps   | `evidence/2026-06-29/outbound-communication-caps-gates.log`                    | Gate 10 - `/email/send` and `/sms/send` have Redis-backed daily user/org volume caps before provider egress, plus SMS estimated spend caps                                      |
| Env example completeness      | `evidence/2026-06-29/env-example-completeness-gates.log`                       | Gate 7/12 - `.env.example` documents the named readiness knobs for OpenAPI docs, rate-limit Redis enforcement, query guard rejection, tenant guard rollout, and backup evidence |
| RBAC decision cache           | `evidence/2026-06-29/rbac-decision-cache-gates.log`                            | Gate 5/10 - user role/permission decisions use a bounded cache with local + Redis Pub/Sub invalidation on role assignment and role-permission mutations                         |
| PII live DB ciphertext        | `evidence/2026-06-29/pii-live-db-ciphertext-gates.log`                         | Gate 5/9 - real `@bidstack/db` singleton stores Contact email/phone as ciphertext and `email_hash` in Postgres, proven via `$queryRaw` raw-row assertion                        |
| Production Redis fail-fast    | `evidence/2026-06-29/production-redis-url-fail-fast-gates.log`                 | Gate 7/10 - API and worker production env validation reject missing, malformed, or loopback Redis URLs before booting multi-replica safety controls                             |
| Plaintext PII decision gate   | `evidence/2026-06-29/plaintext-pii-decision-evidence-gates.log`                | Gate 5/13 - strict PII evidence now requires a reviewable storage-only decision owner/reference and exact accepted-field scope for known plaintext PII surfaces                 |
| Sentry smoke evidence gate    | `evidence/2026-06-29/sentry-smoke-release-evidence-gates.log`                  | Gate 11/13 - strict Sentry evidence requires release/environment/project-scoped API + worker issue queries and privacy-safe compact metadata                                    |

| MCP tool-call evidence gates | `evidence/2026-06-29/mcp-tool-call-evidence-gates.log` | Gate 4 - MCP strict evidence requires discovery, tools/list, and a privacy-safe read-only tools/call smoke |
| Tenant-scope guard gates | `evidence/2026-06-29/tenant-scope-guard-gates.log` | Gate 5 - opt-in Prisma guard catches broad tenant-model operations without orgId |

| PII storage/User.email gates | `evidence/2026-06-29/pii-storage-user-email-gates.log` | Gate 5/13 - strict PII evidence now requires storage-at-rest proof and `User.email` storage-only decision owner/reference |

## Deliverable documents

| Doc                                | Status                                              |
| ---------------------------------- | --------------------------------------------------- |
| `RELEASE_GATE_MATRIX.md`           | refreshed this session                              |
| `PRODUCTION_READINESS_REPORT.md`   | refreshed this session                              |
| `SECURITY_REVIEW.md`               | new — consolidated findings + fixes                 |
| `AUTHORIZATION_MATRIX.md`          | new — 313-route resource×action matrix              |
| `QA_TEST_RESULTS.md`               | new — test evidence + flakiness analysis            |
| `DISASTER_RECOVERY_PLAN.md`        | new — grounded in compose/Dockerfiles/Azure scripts |
| `DEPLOYMENT_RUNBOOK.md`            | new — build/migrate/deploy/evidence-gate sequence   |
| `ROLLBACK_RUNBOOK.md`              | new — app + DB (forward-only Prisma) rollback       |
| `INVENTORY.md`, `UNKNOWN_ITEMS.md` | pre-existing (2026-06-27)                           |

## Pre-existing evidence (prior sessions, still valid)

- `docs/audits/SECURITY_AUDIT_2026-06-27.md` — 4-dimension security audit.
- `docs/security/THREAT-MODEL.md` — threat model (33K).
- `docs/qa/flaky-suite-2026-06-27.md` — flaky-suite root-cause + plan.
- Commits: `7c34c770`, `208efe0e`, `20a72e6e`, `61e0d9dd`, `00bebc0b`, `0dd353d8`, `f08a9ed1`.

## Code changes this session

- 5 fused commits from `feat/fixloop-mantu` (opportunity/proposal/top-accounts) — security-reviewed (delete actions gated).
- AuthZ hardening (uncommitted, ready to commit): `email.ts`, `twilio.ts`, `crm/widgets.ts` — 4 gates added.
- PII ciphertext release evidence gate (uncommitted): `deploy:evidence:pii` raw-count artifact, storage/User.email posture proof, strict verifier checks, bundle preflight, and operator docs.
- Webhook signing-secret hardening/evidence gate (uncommitted): strict runtime decrypt helper, keyed `secretHash` lookup for inbound Dust production resolution, operator backfill script, `deploy:evidence:webhooks` raw decrypt/hash-count artifact, strict verifier checks, bundle preflight, and operator docs.
- Telemetry privacy scrub hardening (uncommitted): Fastify/Pino serializers + log-argument hook and Sentry event scrubber cover URL/query-string PII, generic email/phone strings, exception values, breadcrumbs, headers, and token-shaped values.
- Migration backup guard (uncommitted): root `pnpm db:migrate:deploy`, Docker `migrate` target, and compose path require `scripts/run-safe-migrate-deploy.mjs` backup proof verification before staging/production migrations.
- Public-flow E2E hardening (uncommitted): public booking/e-signature specs now hard-fail instead of self-skipping, blank fixture env values fall back to seeded defaults, opportunity Documents mounts Send for Signature, and standard seed resets only the repeatable E2E booking attendee.
- PDF renderer runtime hardening (uncommitted): document service resolves explicit/system Chromium paths before launching Puppeteer, API Docker image installs Chromium and sets `PUPPETEER_EXECUTABLE_PATH`, and local image build/runtime probe pass.
- Container SBOM evidence hardening (uncommitted): Trivy runner writes raw vulnerability JSON and CycloneDX SBOM JSON per image; strict deploy verifier selftests reject compact-only, missing-raw-report, missing-SBOM, mutable-tag, and missing-coverage evidence.
- KAM handoff UI hardening (uncommitted): KAM account cockpit lists OM handoffs, exports/downloads the ABC OM JSON payload, previews the payload, and confirms only with an ABC OM reference.
- A11y/cross-browser release evidence hardening (uncommitted): `deploy:evidence:a11y` writes a privacy-safe Playwright-derived artifact for axe/color/keyboard specs; strict verifier and bundle require it before browser evidence; cockpit/quick-add/settings browser regressions are fixed locally.
- API connectivity evidence hardening (uncommitted): `deploy:evidence:api` now requires a no-match authenticated `GET /api/companies` domain read smoke and rejects raw response data in strict evidence.
- MCP connectivity evidence hardening (uncommitted): `deploy:evidence:mcp` accepts object-shaped server discovery metadata, executes a default no-match `crm_search_companies` `tools/call`, and the strict verifier rejects missing tool-call proof or raw tool output.
- Tenant-scope guard hardening (uncommitted): `BIDSTACK_TENANT_SCOPE_GUARD=warn|enforce` registers an opt-in Prisma middleware that catches broad tenant-model list/count/aggregate/group/updateMany/deleteMany operations without `orgId`; full DB RLS remains open.
- Twilio inbound SMS idempotency (uncommitted): inbound webhook processing catches duplicate `MessageSid` writes as already processed, avoids duplicate CRM activity on retry, keeps STOP consent idempotent, chooses the Twilio token by receiving number, and validates signatures with an explicit Twilio number when available.
- Outbound communication caps (uncommitted): `/email/send` and `/sms/send` reserve Redis-backed daily user/org volume before provider egress; SMS also reserves estimated segment spend and production fails closed when Redis-backed caps are unavailable.
- Provider timeout hardening (uncommitted): Gmail/Google, Microsoft Graph, Slack, Twilio, and OAuth token/profile fetches use shared bounded `fetchWithTimeout` calls and typed 504 serialization; live timeout-drill proof is still required.
- OAuth refresh lock hardening (uncommitted): Gmail and Microsoft Graph refreshes use Redis-backed per-token single-flight; waiters reuse the persisted token and production fails closed if Redis locking is unavailable; live multi-replica concurrency proof is still required.
- CSP single-source hardening (uncommitted): Helmet CSP is disabled, `securityHeadersPlugin` owns the effective CSP and Permissions-Policy, and focused Fastify header tests prove the response header matches the shared builder; live deployed header smoke still required.
- Env example completeness (uncommitted): `.env.example` documents `OPENAPI_DOCS_ENABLED`, `RATE_LIMIT_REDIS_REQUIRED`, `QUERY_GUARD_REJECT`, `BIDSTACK_TENANT_SCOPE_GUARD`, `BACKUP_S3_BUCKET`, and `BACKUP_ENCRYPT_KEY`; live backup/restore and deployed config evidence remain open.
- RBAC decision cache hardening (uncommitted): `requireRole` and human `requirePermission` decisions now use a bounded 30s in-process cache with explicit user/org invalidation and Redis Pub/Sub fanout; API-key scope checks remain uncached and exact. Role assignment, role permission, JIT admin grant, and stub-auth role changes invalidate the cache.
- PII live DB ciphertext regression (uncommitted): `packages/db` now loads root env for integration tests, and the real `@bidstack/db` singleton is covered by a raw `$queryRaw` storage assertion so Contact email/phone plaintext cannot silently persist when PII encryption is enabled.
- Production Redis URL fail-fast (uncommitted): API and worker production boot validation now requires an explicit non-loopback `redis:`/`rediss:` URL, aligning with the MCP contract and preventing localhost Redis defaults from carrying into production.

## Still requires infrastructure access (NOT obtainable locally — see UNKNOWN_ITEMS.md)

Live IAM/network/TLS scan · cloud backup config + offsite/immutability · actual production/staging pre-migrate backup proof artifact · production restore + rollback drills · k6 load/stress/soak at expected traffic · live container vuln/SBOM scan on immutable release digests enforced in CI · CI clean-run + branch-protection review · runtime observability/alert validation · live `deploy:evidence:pii` and `deploy:evidence:webhooks` release DB artifacts · live strict `deploy:evidence:a11y` and `deploy:evidence:browser` artifacts on a non-local Clerk target · PII storage-level-encryption confirmation · compliance/legal sign-off.

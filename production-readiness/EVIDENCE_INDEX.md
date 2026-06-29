# BidStack 360° — Evidence Index

**Session:** 2026-06-28/29 · **Branch:** feat/prod-hardening-mantu · **Access:** local repo only.

Raw command output for this session is under `production-readiness/evidence/2026-06-28/` and
`production-readiness/evidence/2026-06-29/`.

## Command-output evidence (this session)

| Evidence                      | File                                                                           | Proves                                                                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Typecheck (all packages)      | `evidence/2026-06-28/typecheck.log` (exit 0)                                   | Gate 4/9 — type safety on current tree                                                                                                |
| Production build (all apps)   | `evidence/2026-06-28/build.log` (exit 0)                                       | Gate 3/9 — buildable artifacts                                                                                                        |
| Unit (mcp 54, shared 149)     | `evidence/2026-06-28/unit-nondb.log`                                           | Gate 9 — non-DB unit suites                                                                                                           |
| SAST (semgrep)                | `evidence/2026-06-28/semgrep-sast.log` + `deploy-evidence/semgrep-latest.json` | Gate 8 — 0 findings / 1568 files (OWASP Top 10)                                                                                       |
| Dependency audit              | `pnpm audit` (inline)                                                          | Gate 8 — 0 high/critical                                                                                                              |
| API integration suite         | `evidence/2026-06-28/api-suite-run{1,3,4}.log` (clean, 808 pass)               | Gate 9 — green when isolated                                                                                                          |
| API suite flakiness analysis  | `evidence/2026-06-28/api-suite-run2.log`, `api-suite-clean-runs.summary`       | Gate 9 — failures traced to contention                                                                                                |
| Backup/restore drill          | `evidence/2026-06-28/backup-restore-drill.log`                                 | Gate 12 — restore _mechanism_ validated locally                                                                                       |
| PII evidence gate selftests   | `evidence/2026-06-28/pii-evidence-gates.log`                                   | Gate 5/13 — `deploy:evidence:pii`, strict verifier, and bundle selftests pass; live DB artifact still required                        |
| Webhook secret gate selftests | `evidence/2026-06-28/webhook-secret-evidence-gates.log`                        | Gate 5 — webhook backfill, `deploy:evidence:webhooks`, strict verifier, and bundle selftests pass; live DB artifact still required    |
| Telemetry privacy scrub gates | `evidence/2026-06-29/telemetry-privacy-scrub-gates.log`                        | Gate 11/13 — Fastify/Pino and Sentry scrub emails, phones, query-string PII, and token-shaped strings before telemetry leaves process |
| Migration backup guard gates  | `evidence/2026-06-29/migration-backup-guard-gates.log`                         | Gate 12 — staging/production migrations fail closed without fresh encrypted pre-migrate backup proof tied to `DATABASE_URL`           |
| Public-flow E2E hardening     | `evidence/2026-06-29/e2e-public-flows-hardening-gates.log`                     | Gate 3/9 — public booking and e-signature browser flows hard-fail on missing fixtures/UI and pass 8/8 on Chromium                     |
| PDF renderer runtime gates    | `evidence/2026-06-29/pdf-renderer-runtime-gates.log`                           | Gate 7/9 — API Docker image builds with Chromium, exposes Puppeteer path, and runtime probe confirms executable Chromium              |
| Container SBOM gate hardening | `evidence/2026-06-29/container-sbom-gate-hardening.log`                        | Gate 7/8 — strict container evidence selftests require raw Trivy vuln JSON + CycloneDX SBOM JSON per immutable image                  |
| KAM handoff UI gates          | `evidence/2026-06-29/kam-handoff-ui-gates.log`                                 | Gate 3/9 — KAM cockpit exposes ABC OM handoff export/confirm UI with focused test/typecheck/lint/build proof                          |
| Webhook secret hash gates     | `evidence/2026-06-29/webhook-secret-hash-gates.log`                            | Gate 5/13 — webhook subscriptions use keyed lookup hashes; strict evidence rejects missing/invalid hashes                             |

| MCP tool-call evidence gates | `evidence/2026-06-29/mcp-tool-call-evidence-gates.log` | Gate 4 - MCP strict evidence requires discovery, tools/list, and a privacy-safe read-only tools/call smoke |

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
- PII ciphertext release evidence gate (uncommitted): `deploy:evidence:pii` raw-count artifact, strict verifier checks, bundle preflight, and operator docs.
- Webhook signing-secret hardening/evidence gate (uncommitted): strict runtime decrypt helper, keyed `secretHash` lookup for inbound Dust production resolution, operator backfill script, `deploy:evidence:webhooks` raw decrypt/hash-count artifact, strict verifier checks, bundle preflight, and operator docs.
- Telemetry privacy scrub hardening (uncommitted): Fastify/Pino serializers + log-argument hook and Sentry event scrubber cover URL/query-string PII, generic email/phone strings, exception values, breadcrumbs, headers, and token-shaped values.
- Migration backup guard (uncommitted): root `pnpm db:migrate:deploy`, Docker `migrate` target, and compose path require `scripts/run-safe-migrate-deploy.mjs` backup proof verification before staging/production migrations.
- Public-flow E2E hardening (uncommitted): public booking/e-signature specs now hard-fail instead of self-skipping, blank fixture env values fall back to seeded defaults, opportunity Documents mounts Send for Signature, and standard seed resets only the repeatable E2E booking attendee.
- PDF renderer runtime hardening (uncommitted): document service resolves explicit/system Chromium paths before launching Puppeteer, API Docker image installs Chromium and sets `PUPPETEER_EXECUTABLE_PATH`, and local image build/runtime probe pass.
- Container SBOM evidence hardening (uncommitted): Trivy runner writes raw vulnerability JSON and CycloneDX SBOM JSON per image; strict deploy verifier selftests reject compact-only, missing-raw-report, missing-SBOM, mutable-tag, and missing-coverage evidence.
- KAM handoff UI hardening (uncommitted): KAM account cockpit lists OM handoffs, exports/downloads the ABC OM JSON payload, previews the payload, and confirms only with an ABC OM reference.
- MCP connectivity evidence hardening (uncommitted): `deploy:evidence:mcp` accepts object-shaped server discovery metadata, executes a default no-match `crm_search_companies` `tools/call`, and the strict verifier rejects missing tool-call proof or raw tool output.

## Still requires infrastructure access (NOT obtainable locally — see UNKNOWN_ITEMS.md)

Live IAM/network/TLS scan · cloud backup config + offsite/immutability · actual production/staging pre-migrate backup proof artifact · production restore + rollback drills · k6 load/stress/soak at expected traffic · live container vuln/SBOM scan on immutable release digests enforced in CI · CI clean-run + branch-protection review · runtime observability/alert validation · live `deploy:evidence:pii` and `deploy:evidence:webhooks` release DB artifacts · PII storage-level-encryption confirmation · compliance/legal sign-off.

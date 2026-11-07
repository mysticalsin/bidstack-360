# Control map: SOC 2 TSC and ISO 27001:2022 Annex A

This maps each control we claim to the code, tests, CI jobs and evidence script
that back it. The machine readable register is
[`controls.json`](./controls.json). `scripts/write-compliance-evidence.mjs`
reads it, checks that every mapped path, CI job and assertion still exists,
and writes one evidence file per control into `deploy-evidence/compliance/`.
The check runs in CI through `apps/api/src/compliance/compliance-evidence.test.ts`
(unit job), so a renamed file or a removed CI job breaks the build instead of
silently breaking the map.

Status: **implemented** (code, test and CI gate exist), **partial** (some of the
control is in code, the rest is listed as a gap), **gap** (not covered yet).

How to regenerate evidence:

| Command                                 | What it writes                                                |
| --------------------------------------- | ------------------------------------------------------------- |
| `pnpm compliance:evidence:check`        | Path, CI job and assertion checks only. No DB, safe in CI.    |
| `pnpm compliance:evidence`              | Checks plus mapped unit test results and DB counts if set up. |
| `pnpm compliance:evidence:selftest`     | Exercises the checker against a synthetic repo.               |
| `pnpm deploy:evidence:pii` and siblings | Existing release evidence scripts named in the table below.   |

## SOC 2 Trust Services Criteria

| Control                    | Status      | Code                                                                                             | Tests                                                                                           | CI jobs                                                                          | Evidence script                                |
| -------------------------- | ----------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------- |
| SOC2-CC6.1-RBAC            | implemented | `apps/api/src/plugins/rbac.ts`, `packages/shared/src/types/permissions.ts`                       | `__tests__/rbac-matrix.test.ts`, `security/rbac-matrix-routes`, `security/route-authz-census`   | ci.yml unit, integration                                                         | `write-compliance-evidence.mjs`                |
| SOC2-CC6.1-TENANT          | implemented | `apps/api/src/test-support/isolated-org.ts`                                                      | `security/tenant-isolation-sweep`, `security/rbac-side-doors`                                   | ci.yml integration                                                               | `write-compliance-evidence.mjs`                |
| SOC2-CC6.1-SECRETS         | implemented | `scripts/check-secrets.sh`                                                                       | (scanner)                                                                                       | ci.yml secrets-full-scan, gitleaks.yml                                           | `write-secret-scan-evidence.mjs`               |
| SOC2-CC6.2-AUTH            | implemented | `apps/api/src/plugins/auth.ts`, `plugins/auth-audit.ts`                                          | `plugins/auth.test.ts`, `plugins/auth-audit.test.ts`                                            | ci.yml unit                                                                      | `write-compliance-evidence.mjs`                |
| SOC2-CC6.3-ROLES           | implemented | `apps/api/src/lib/rbac-decision-cache.ts`                                                        | `routes/users.roles`, `lib/rbac-decision-cache.revocation`                                      | ci.yml unit, integration                                                         | `write-compliance-evidence.mjs`                |
| SOC2-CC6.6-BOUNDARY        | implemented | `plugins/security-headers.ts`, `lib/cors-origins.ts`, `plugins/query-guard.ts`                   | `plugins/security-headers.test.ts`, `lib/cors-origins.test.ts`                                  | ci.yml unit                                                                      | `write-compliance-evidence.mjs`                |
| SOC2-CC6.7-ENCRYPTION      | implemented | `packages/db/src/middleware/pii-encryption.ts` (PII_MAP)                                         | `middleware/pii-encryption.test.ts`, `pii-field-encryption.integration.test.ts`                 | ci.yml unit                                                                      | `write-pii-ciphertext-evidence.mjs`            |
| SOC2-CC6.7-WEBHOOK-SECRETS | implemented | `scripts/encrypt-webhook-secrets.ts`                                                             | `security/penetration.webhook.test.ts`                                                          | ci.yml unit                                                                      | `write-webhook-secret-ciphertext-evidence.mjs` |
| SOC2-CC6.8-SUPPLY-CHAIN    | implemented | `supply-chain.yml`, `dependency-review.yml`                                                      | (scanners)                                                                                      | ci.yml unit (pnpm audit), supply-chain vuln-scan and iac-scan, dependency-review | `write-compliance-evidence.mjs`                |
| SOC2-CC7.1-VULN            | implemented | `semgrep.yml`                                                                                    | `security/penetration.access-control`, `security/penetration.injection-upload`                  | semgrep.yml, ci.yml unit                                                         | `write-compliance-evidence.mjs`                |
| SOC2-CC7.2-MONITORING      | implemented | `plugins/sentry.ts`, `lib/sentry-privacy.ts`                                                     | `lib/sentry-privacy.test.ts`, `plugins/sentry.test.ts`                                          | ci.yml unit                                                                      | `write-sentry-smoke-evidence.mjs`              |
| SOC2-CC7.4-INCIDENT        | partial     | `production-readiness/DISASTER_RECOVERY_PLAN.md`, `ROLLBACK_RUNBOOK.md`                          | none                                                                                            | none                                                                             | `write-operational-readiness-evidence.mjs`     |
| SOC2-CC8.1-CHANGE          | implemented | `.github/workflows/ci.yml`                                                                       | (gate list)                                                                                     | ci.yml unit, integration, e2e                                                    | `write-source-control-evidence.mjs`            |
| SOC2-CC4.1-AUDIT-CHAIN     | implemented | `apps/api/src/lib/audit-chain.ts`, `packages/db/src/middleware/audit-immutability.ts`            | `security/audit-chain`, `middleware/audit-immutability.test.ts`                                 | ci.yml unit, integration                                                         | `write-compliance-evidence.mjs`                |
| SOC2-A1.2-BACKUP           | partial     | `scripts/backup-postgres.sh`, `scripts/backup-restore-selftest.sh`                               | none                                                                                            | none                                                                             | `write-operational-readiness-evidence.mjs`     |
| SOC2-C1.1-CLASSIFY         | implemented | `packages/db/src/compliance/personal-data-map.ts`                                                | `compliance/personal-data-map.test.ts`                                                          | ci.yml unit                                                                      | `write-compliance-evidence.mjs`                |
| SOC2-C1.2-DISPOSAL         | implemented | `packages/db/src/compliance/retention.ts`, `apps/worker/src/queues/retention-sweep.ts`           | `compliance/retention.test.ts`, `queues/retention-sweep.test.ts`, `routes/compliance-retention` | ci.yml unit, integration                                                         | `write-compliance-evidence.mjs`                |
| SOC2-P5.1-ACCESS           | implemented | `compliance/data-subject.ts`, `routes/data-subject-requests.ts`, `worker queues/data-subject.ts` | `routes/data-subject-requests`, `queues/data-subject.test.ts`                                   | ci.yml unit, integration                                                         | `write-compliance-evidence.mjs`                |
| SOC2-P4.3-ERASE            | implemented | `compliance/data-subject.ts`, `routes/erasure.ts`, `routes/data-subject-requests.ts`             | `routes/data-subject-requests`, `routes/erasure`                                                | ci.yml integration                                                               | `write-compliance-evidence.mjs`                |
| SOC2-PI1.2-INPUT           | implemented | `apps/api/src/security/route-authz-allowlist.ts`                                                 | `security/route-contract-ratchet`                                                               | ci.yml integration                                                               | `write-compliance-evidence.mjs`                |

## ISO 27001:2022 Annex A

| Control                      | Status      | Code                                                                                                                                                             | Tests                                                                                   | CI jobs                                | Evidence script                            |
| ---------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------ |
| ISO-A.5.12-CLASSIFICATION    | implemented | `packages/db/src/compliance/personal-data-map.ts`                                                                                                                | `compliance/personal-data-map.test.ts`                                                  | ci.yml unit                            | `write-compliance-evidence.mjs`            |
| ISO-A.5.15-ACCESS-CONTROL    | implemented | `packages/shared/src/types/permissions.ts`, `production-readiness/AUTHORIZATION_MATRIX.md`                                                                       | `__tests__/rbac-matrix.test.ts`                                                         | ci.yml unit                            | `write-compliance-evidence.mjs`            |
| ISO-A.5.18-ACCESS-RIGHTS     | implemented | `apps/api/src/lib/rbac-decision-cache.ts`                                                                                                                        | `routes/users.roles`                                                                    | ci.yml integration                     | `write-compliance-evidence.mjs`            |
| ISO-A.5.23-CLOUD-RESIDENCY   | partial     | `shared/schemas/compliance.ts`, `routes/org-settings.ts`, `api storage/index.ts`, `worker lib/tenant-export-storage.ts`, `web settings/DataResidencySection.tsx` | `schemas/compliance.test.ts`, `routes/data-residency`, `DataResidencySection.test.tsx`  | ci.yml unit, integration               | `write-compliance-evidence.mjs`            |
| ISO-A.5.24-INCIDENT          | gap         | `production-readiness/DISASTER_RECOVERY_PLAN.md`                                                                                                                 | none                                                                                    | none                                   | `write-operational-readiness-evidence.mjs` |
| ISO-A.5.33-RECORDS           | implemented | `apps/api/src/lib/audit-chain.ts`                                                                                                                                | `security/audit-chain`                                                                  | ci.yml integration                     | `write-compliance-evidence.mjs`            |
| ISO-A.5.34-PII               | implemented | `compliance/data-subject.ts`, `compliance/retention.ts`, `docs/compliance/AI-ACT-DPIA.md`                                                                        | `routes/data-subject-requests`, `routes/compliance-retention`                           | ci.yml integration                     | `write-compliance-evidence.mjs`            |
| ISO-A.8.3-ACCESS-RESTRICTION | implemented | `apps/api/src/meeting-intel/access.ts`, `apps/api/src/org-chart/access.ts`                                                                                       | `security/tenant-isolation-sweep`, `meeting-intel/meeting-permissions`                  | ci.yml integration                     | `write-compliance-evidence.mjs`            |
| ISO-A.8.8-VULNERABILITIES    | implemented | `supply-chain.yml`                                                                                                                                               | (scanners)                                                                              | ci.yml unit, supply-chain vuln-scan    | `write-compliance-evidence.mjs`            |
| ISO-A.8.10-DELETION          | implemented | `compliance/data-subject.ts`, `compliance/retention.ts`                                                                                                          | `routes/data-subject-requests`, `routes/compliance-retention`                           | ci.yml integration                     | `write-compliance-evidence.mjs`            |
| ISO-A.8.11-MASKING           | implemented | `lib/logger.ts`, `lib/sentry-privacy.ts`, `shared/public-sector/cl/common.ts`, `lib/ai-audit.ts`                                                                 | `lib/logger.test.ts`, `lib/sentry-privacy.test.ts`, `public-sector/cl/ocds-api.test.ts` | ci.yml unit                            | `write-compliance-evidence.mjs`            |
| ISO-A.8.12-LEAKAGE           | partial     | `scripts/check-secrets.sh`                                                                                                                                       | (scanner)                                                                               | ci.yml secrets-full-scan, gitleaks.yml | `write-secret-scan-evidence.mjs`           |
| ISO-A.8.13-BACKUP            | partial     | `scripts/backup-postgres.sh`, `production-readiness/BACKUP_RESTORE_REPORT.md`                                                                                    | none                                                                                    | none                                   | `write-operational-readiness-evidence.mjs` |
| ISO-A.8.15-LOGGING           | implemented | `plugins/mutation-audit.ts`, `lib/ai-audit.ts`, `worker queues/ai-audit-retention.ts`                                                                            | `plugins/mutation-audit.test.ts`, `queues/ai-audit-retention.test.ts`                   | ci.yml unit                            | `write-compliance-evidence.mjs`            |
| ISO-A.8.16-MONITORING        | implemented | `plugins/sentry.ts`, `routes/health.ts`                                                                                                                          | `routes/health.test.ts`                                                                 | ci.yml unit                            | `write-sentry-smoke-evidence.mjs`          |
| ISO-A.8.24-CRYPTO            | implemented | `packages/db/src/middleware/pii-encryption.ts`, `docs/security/pii-field-encryption.md`                                                                          | `middleware/pii-encryption.test.ts`                                                     | ci.yml unit                            | `write-pii-ciphertext-evidence.mjs`        |
| ISO-A.8.25-SDLC              | implemented | `.github/workflows/ci.yml`                                                                                                                                       | (gate list)                                                                             | ci.yml unit, integration, e2e          | `write-ci-repeat-evidence.mjs`             |
| ISO-A.8.26-APPSEC            | implemented | `apps/api/src/security/route-authz-allowlist.ts`                                                                                                                 | `security/route-contract-ratchet`, `security/route-authz-census`                        | ci.yml integration                     | `write-compliance-evidence.mjs`            |
| ISO-A.8.28-SECURE-CODING     | implemented | `semgrep.yml`                                                                                                                                                    | `security/penetration.injection-upload`                                                 | semgrep.yml                            | `write-compliance-evidence.mjs`            |
| ISO-A.8.32-CHANGE            | implemented | `.github/workflows/ci.yml`                                                                                                                                       | (gate list)                                                                             | ci.yml unit                            | `write-source-control-evidence.mjs`        |

Test paths are relative to the owning app or package (`apps/api/src/...`,
`packages/db/src/...`); full paths are in `controls.json`.

## GDPR data subject requests

- **Engine:** `packages/db/src/compliance/data-subject.ts`. A subject is a
  contact, a lead or an account person (org chart node). The engine merges
  linked records (a node's contact, a contact's nodes) and matches by id,
  email, phone and full name across every store in
  `personal-data-map.ts`: activities and attendees, calendar events, email
  messages and tracking pixels, SMS, account people, contact facts,
  commitments, meeting intel and attendees, meeting ingest payloads, account
  management sessions, governance meetings, bookings, calls and summaries,
  references, notifications, intel evidence, signatures and the audit log.
- **Export:** `POST /api/v1/orgs/:orgId/data-subject-requests` with
  `kind: export` queues a job; `GET .../:id/export` rebuilds the bundle live
  (it is never stored at rest) and writes `gdpr.export.downloaded`.
- **Erase:** same endpoint with `kind: erase`. `dryRun` defaults to `true` and
  reports per store counts without changing anything (`gdpr.erasure.dry_run`).
  A real run tombstones the subject, scrubs or deletes sidecar rows in one
  transaction, runs a residue scan over every org scoped text and JSON column,
  and writes `gdpr.erasure` with field names and counts only. The older
  synchronous `POST /orgs/:orgId/erasure` now calls the same engine.
- **Audit log:** rows are pseudonymised, not deleted. The hash chain covers the
  diff, so diffs cannot change; the subject row they point at is tombstoned,
  the count is reported as `auditRowsPseudonymised`, and the erase test
  verifies the chain after the run.
- **Retained under a legal basis:** SMS opt-out records (needed to keep
  honouring the opt-out) and signature evidence (Art 17(3)(e)). The residue
  report lists them as `retained: true`.
- **Coverage ratchet:** `personal-data-map.test.ts` reads the Prisma schema and
  fails when a model gains a personal data field that is neither in
  `SUBJECT_STORES` nor in `NON_SUBJECT_STORES` with a reason.
- **Access:** `settings:write` (admin only), org scoped, rate limited.
  Worker: `apps/worker/src/queues/data-subject.ts` (queue `data-subject-request`).

## Retention per data class

The worker `retention-sweep` runs daily (`RETENTION_SWEEP_CRON`, default
`45 3 * * *`). It only reports until `RETENTION_MODE=enforce`. Users with
`settings:read` see the same dry run report at `GET /api/v1/compliance/retention`. A missing, zero or
invalid period falls back to the default, so a typo cannot shorten retention.

| Data class              | Env var                                | Default (days) | Action                               |
| ----------------------- | -------------------------------------- | -------------- | ------------------------------------ |
| email_messages          | `RETENTION_EMAIL_MESSAGES_DAYS`        | 730            | delete (tracking pixels cascade)     |
| sms_messages            | `RETENTION_SMS_MESSAGES_DAYS`          | 730            | delete (opt-out records kept)        |
| calendar_events         | `RETENTION_CALENDAR_EVENTS_DAYS`       | 730            | delete                               |
| call_transcripts        | `RETENTION_CALL_TRANSCRIPTS_DAYS`      | 365            | scrub transcript and recording link  |
| meeting_transcripts     | `RETENTION_MEETING_TRANSCRIPTS_DAYS`   | 365            | scrub transcript, keep summary       |
| kam_transcripts         | `RETENTION_KAM_TRANSCRIPTS_DAYS`       | 365            | scrub transcript, keep approved note |
| meeting_ingest_payloads | `RETENTION_MEETING_INGEST_DAYS`        | 90             | delete                               |
| intel_evidence          | `RETENTION_INTEL_EVIDENCE_DAYS`        | 1095           | delete                               |
| notifications           | `RETENTION_NOTIFICATIONS_DAYS`         | 180            | delete                               |
| voice_commands          | `RETENTION_VOICE_COMMANDS_DAYS`        | 90             | delete                               |
| data_subject_requests   | `RETENTION_DATA_SUBJECT_REQUESTS_DAYS` | 1095           | delete (the audit event stays)       |

AI invocation logs keep their own job and variable (`AI_AUDIT_RETENTION_DAYS`,
default 90). The audit log has no retention job: deleting rows would break
the chain, and its retention is a policy decision still to be made.

## Data residency

Each org can store a region tag (`eu`, `uk`, `us`, `ca`, or not pinned) in
Settings, Security. It is saved on `org_settings.data_region` and audited.

What is enforced today:

- **Tenant exports.** The worker uploads the archive to `S3_BUCKET_<REGION>`
  (region `S3_REGION_<REGION>`) and the API signs downloads against the same
  bucket. Without a regional bucket the export uses `S3_BUCKET`, unless
  `DATA_RESIDENCY_ENFORCE=true`, in which case it fails instead of leaving the
  region.

Not enforceable yet (stated in the settings screen as well):

- **File uploads and documents** use the single `getStorage()` adapter.
- **Call recordings** use `CALL_RECORDINGS_S3_REGION`, one per deployment.
- **The primary database and Redis** are one per deployment; per region
  tenancy needs a deployment per region.
- **LLM and data providers** are chosen per org credential or per deployment,
  not by region.
- The local storage driver ignores the tag.

## Known gaps

1. No security incident procedure or breach notification runbook (SOC2-CC7.4-INCIDENT, ISO-A.5.24-INCIDENT).
2. Backup restore self test is not scheduled in CI (SOC2-A1.2-BACKUP, ISO-A.8.13-BACKUP).
3. Data residency covers tenant exports only (ISO-A.5.23-CLOUD-RESIDENCY).
4. Audit diffs written before this pack may contain raw personal values; they cannot be rewritten without breaking the chain (SOC2-P4.3-ERASE).
5. Owner only visibility for unfiled captured mail depends on the email capture slice, not on main yet (ISO-A.8.12-LEAKAGE).
6. Free text that mentions a subject by a short or partial name (under five characters, or first name only) is not matched by the erase engine; full name, email and phone are.
7. No audit log retention period is defined.

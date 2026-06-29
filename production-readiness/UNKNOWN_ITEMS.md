# BidStack 360° — UNKNOWN / Unverifiable Items

Per the review rules, these are **UNKNOWN (≠ PASS)** because they require access, execution, or a decision this autonomous review could not perform. Each names what unblocks it.

## Requires infrastructure / cloud access (no credentials or authorized scope given)

- **Cloud IAM** — least privilege, MFA, no long-lived broad keys, service-account separation, access review. → needs cloud account (read).
- **Network** — security groups/firewall, private subnets, no public DB/admin, restricted SSH/RDP. → needs cloud + authorized external scan scope.
- **DNS / TLS** — cert validity/renewal, HTTPS+HSTS enforcement live, secure redirects. → needs domain + endpoint access.
- **Object storage / buckets** — public-access checks, encryption, lifecycle. → cloud access.
- **Backups** — schedule, encryption, retention, immutability, location. → infra access.

## Requires execution (scripts exist; not run this session)

- **Backup RESTORE drill** (Gate 12, CRITICAL) — `BACKUP_RESTORE_REPORT` needs a real restore with validation. → run in staging.
- **Pre-migrate backup proof artifact** — migration code now enforces `BIDSTACK_MIGRATE_BACKUP_PROOF` for staging/production, but the actual proof JSON must be generated from a real `pg_dump`, managed snapshot, or PITR restore point before each release. → needs staging/prod DB + backup storage access.
- **Load / stress / soak** — `pnpm load-test` (k6). → run against staging at expected traffic.
- **Live API connectivity** — `pnpm deploy:evidence:api` now proves `/livez`, `/readyz`, `/health`, and authenticated `/api/me/capabilities` against a non-local API endpoint. → needs deployed API URL + API key or bearer token.
- **Live MCP connectivity** — `pnpm deploy:evidence:mcp` now proves `/.well-known/mcp`, `/health`, `initialize`, `notifications/initialized`, `tools/list`, and one privacy-safe read-only `tools/call` against a non-local MCP endpoint. → needs deployed MCP URL + bearer token with `mcp` scope.
- **Webhook signing-secret ciphertext/hash proof** — `pnpm webhooks:encrypt-secrets` dry-runs historical `WebhookSubscription.secret` rows, `tsx scripts/encrypt-webhook-secrets.ts --apply` encrypts legacy `whsec_` rows and fills missing/invalid `secret_hash`, and `pnpm deploy:evidence:webhooks` writes privacy-safe raw decrypt/hash counts. → needs staging/prod DB access with `INTEGRATION_TOKEN_KEY` and `BIDSTACK_WEBHOOK_SECRET_PLAINTEXT_FALLBACK=false`.
- **Container image + secret scan** — `pnpm deploy:evidence:container`. → run in CI.
- **SAST / SCA / secret scan** — `pnpm security:scan` (semgrep), dependency audit. → run + review results.
- **CI pipeline clean run + branch-protection review** — → needs CI/repo-admin access.
- **Rollback drill** — deploy + DB-migration rollback in staging.
- **Observability runtime** — trigger test alerts, validate dashboards/log-redaction live.

## Requires a human decision

- **PII backfill/ciphertext proof** — 2026-06-28 code/deploy update now supports safe field encryption for `Contact`, `Lead`, and `KamConsultant`; production env gates require `PII_FIELD_ENCRYPTION=true` + `PII_ENCRYPTION_MASTER_KEY`; `pnpm deploy:evidence:pii` now writes privacy-safe raw DB ciphertext counts and is wired into the strict bundle/verifier. Gate 5/13 still needs operator dry-run/apply evidence from `scripts/encrypt-existing-pii.ts`, a live staging/prod `deploy:evidence:pii` artifact, storage-encryption confirmation, and the `User.email` field-level decision.
- **Webhook secret fallback removal proof** — runtime now fails closed through `decryptWebhookSigningSecret`, and inbound Dust production lookup rejects plaintext-only subscription rows; production release still needs operator backfill/apply evidence plus a live `deploy:evidence:webhooks` artifact showing zero plaintext/unreadable rows and zero missing/invalid secret hashes.
- **Stashed swarm WIP** — keep+review-and-land (PII-at-rest encryption, per-org queue fairness) or drop. Has known bugs (ultrareview).
- **SLO targets, RTO/RPO, compliance targets, expected load** — not provided in the prompt placeholders; needed to score Gates 10/12/13.
- **Authorized-testing scope** — domains, accounts, environments, IPs the red-team/exploit tests may touch.

## Requires a dev-stack / browser session

- **Accessibility (WCAG 2.2 AA)** scan + manual keyboard review (Gate 3).
- **Cross-browser + responsive E2E** evidence.
- **Apple-UX** review/polish.

## Known code-side gaps (verified, deferred)

- Test hermeticity: 39 shared-org integration tests → isolated orgs (needs seed-shape decision).
- Tenant isolation has no RLS/Prisma-extension backstop (manual per-query) — recommended ADR.
- Web unit-test coverage low (per prior known-issues).

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
- **Load / stress / soak** — `pnpm load-test` (k6). → run against staging at expected traffic.
- **Container image + secret scan** — `pnpm deploy:evidence:container`. → run in CI.
- **SAST / SCA / secret scan** — `pnpm security:scan` (semgrep), dependency audit. → run + review results.
- **CI pipeline clean run + branch-protection review** — → needs CI/repo-admin access.
- **Rollback drill** — deploy + DB-migration rollback in staging.
- **Observability runtime** — trigger test alerts, validate dashboards/log-redaction live.

## Requires a human decision
- **`PII_FIELD_ENCRYPTION` prod posture** — confirm `=true` + `PII_ENCRYPTION_MASTER_KEY` set (after `scripts/encrypt-existing-pii.ts`). Else PII plaintext at rest.
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

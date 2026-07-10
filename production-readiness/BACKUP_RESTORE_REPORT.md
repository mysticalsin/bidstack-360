# BidStack 360° — Backup / Restore Report (Gate 12)

**Date:** 2026-06-28 · **Scope:** local mechanism validation only (no production/cloud access this session).

## Drill executed: pg_dump → pg_restore → row-count validation

| Step | Result |
|---|---|
| Source DB | `bidstack` @ `bidcrm-postgres-1` (pgvector:pg16) |
| `pg_dump -Fc` (custom, compressed) | ✅ exit 0 — 1,775,926 bytes |
| Create fresh target `bidstack_restore_test` | ✅ |
| `pg_restore --no-owner --no-privileges` | ✅ exit 0 |
| **Row-count integrity (source vs restored)** | ✅ **exact match** |

| Table | Source | Restored |
|---|---|---|
| orgs | 28 | 28 |
| companies | 45 | 45 |
| contacts | 330 | 330 |
| opportunities | 497 | 497 |
| proposals | 464 | 464 |

Evidence: `production-readiness/evidence/2026-06-28/backup-restore-drill.log`.

## What this proves
The **logical backup/restore procedure works end-to-end** against a representative, schema-complete database, with verified row-count integrity after restore. A full `pg_dump`/`pg_restore` cycle is a valid disaster-recovery primitive for this Prisma/Postgres app.

## What this does NOT prove (still blocking for Gate 12 PASS — requires infra access)
- **Production backups exist and are current** — schedule, encryption at rest, retention, immutability/object-lock, offsite/cross-region copy. None verified.
- **Production restore drill** — restore of an actual production (or production-shaped staging) backup, with application boot + smoke test against the restored data.
- **Point-in-time recovery (PITR)** — WAL archiving / PITR is a managed-Postgres feature; not exercised here.
- **RTO / RPO measured** — this local dump+restore of a ~1.8 MB DB took seconds; production data volume RTO/RPO is unmeasured and must be ratified by Tony.
- **Backup-failure alerting** — no alert tested.

## Recommended next steps (staging/prod, needs access)
1. Confirm managed-Postgres automated backups + PITR are enabled; record retention + region.
2. Run a restore of a production-shaped backup in staging; boot the app; smoke-test; **measure actual RTO/RPO**.
3. Verify object-storage backups (versioning + object-lock) and Key Vault / secret recovery.
4. Add a backup-failure alert and test it (trigger a failed backup).
5. Ratify RTO/RPO targets and the break-glass + key-escrow procedure (see DISASTER_RECOVERY_PLAN.md).

## Gate 12 status: **PARTIAL** — mechanism proven locally; production backup existence + restore + RTO/RPO remain unverified (infra access required).

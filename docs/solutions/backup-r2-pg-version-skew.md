# Backup / restore: R2 offsite and PG client/server skew

## Problem

A restore drill using `pg_dump` 17 against Postgres 16 restored every table
(179 matched) but `scripts/restore-postgres.sh` exited non-zero because
`pg_restore` applied `SET transaction_timeout = 0` (a PG17 GUC). PG16
rejects that parameter. Treating that SET as fatal hid a successful restore.

Offsite copies were also still an owner decision. Destination is now
Cloudflare R2 (S3 API), bucket `polo-backups`, 14-day retention.

## Approach

1. Resolve `pg_dump` / `pg_restore` with the same major as `SHOW server_version`
   when that binary exists (`pg_restore-16`, `/usr/lib/postgresql/16/bin/...`).
2. If the only client is newer, run restore and ignore **only** stderr lines
   that mention `transaction_timeout`. Any other error stays fatal.
3. Upload to R2 only when `POLO_BACKUP_S3_ENDPOINT` and the R2 access keys
   are set. Otherwise print a skip line and keep the local dump.

## Restore drill

1. `pnpm db:backup:client-test` (no database).
2. `pnpm db:backup:selftest` against a throwaway URL (synthetic table, row counts).
3. On the real volume: `pnpm db:backup`, copy the dump (or pull `s3://polo-backups/polo-*.dump` from R2 when offsite is configured), restore into a **non-production** `POLO_RESTORE_DATABASE_URL`, compare public-table counts.
4. A PG17 client on PG16 must finish with exit 0 if the only stderr is `transaction_timeout`.

## Verify

```bash
pnpm db:backup:client-test
# with DATABASE_URL:
pnpm db:backup:selftest
```

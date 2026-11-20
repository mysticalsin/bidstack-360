# Polo restore must recreate app_role

## Problem

Polo boots from a fresh `initdb` cluster and restores a database-only
`pg_dump -Fc`. Cluster roles are not in that dump. After restore,
`_prisma_migrations` already lists `20261112160000_audit_log_app_role_revoke_delete`
and `20261112180000_audit_log_app_role_runtime`, so `prisma migrate deploy`
does not create `app_role`. `ALTER ROLE app_role PASSWORD` then fails the
boot, and the GRANTs inside `pg_restore` had already been ignored.

## Pattern

- Create `app_role` with `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE` before
  `pg_restore`, so the dump's grants have a target. Run the same statement
  at the start of migrate. Both branches are idempotent.
- Set the password only after migrate, from `POLO_APP_DB_PASSWORD`. Do not
  put the password in the role statement or the logs.
- `pg_restore` exit status matters. The one harmless error is schema
  `public` already existing, because `createdb` made it. Anything else
  fails the boot.

## Implementation

- `apps/polo-preview/src/database-boot.js`
- `apps/polo-preview/container/entrypoint.mjs` calls it from `restoreFrom`
  and `migrate`.

## Verification

The drill does not run under `pnpm test`. Set `POLO_RESTORE_DRILL=1`.

```
POLO_RESTORE_DRILL=1 pnpm --filter @bidstack/polo-preview exec vitest run src/restore-migrated-snapshot.integration.test.ts
```

Postgres 16 client tools (`initdb`, `pg_dump`, `pg_restore`), the pgvector
package for that server, and `redis-server` must be installed. Without
pgvector, migrate fails with P3018 on `20260527000000_rfp_vector_indexes`.
The drill locates Postgres 16 at `/usr/lib/postgresql/16/bin` or on `PATH`.
It uses a temp directory and free ports. Restore onto a database that
already has objects fails the boot; the container's disk is fresh on every
boot, so that is the path this entrypoint takes.

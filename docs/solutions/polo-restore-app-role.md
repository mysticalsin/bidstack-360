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

```
POLO_RESTORE_DRILL=1 pnpm --filter @bidstack/polo-preview exec vitest run src/restore-migrated-snapshot.integration.test.ts
```

Postgres 16 client tools (`initdb`, `pg_dump`, `pg_restore`) and
`redis-server` must be installed. The drill locates Postgres 16 at
`/usr/lib/postgresql/16/bin` or on `PATH`.

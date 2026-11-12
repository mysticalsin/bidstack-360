# Active import index — precheck, rollback, and a failed deploy

Migration `20261112170000_migration_jobs_one_active_per_org_source` creates unique index `migration_jobs_one_active_per_org_source`.

`CREATE UNIQUE INDEX` fails if one org already has more than one `PENDING` or `RUNNING` row for `CSV` or `SALESFORCE_CSV`. This note does not delete or rewrite those rows.

Run this against the owner login on the direct (`:5432`) database, before `prisma migrate deploy`.

## Precheck (mandatory, read-only)

If the query returns any row, **STOP**. Do not run `prisma migrate deploy`.

```sql
SELECT org_id, source, count(*) AS active
FROM migration_jobs
WHERE "status" IN ('PENDING', 'RUNNING')
  AND "source" IN ('CSV', 'SALESFORCE_CSV')
GROUP BY org_id, source
HAVING count(*) > 1;
```

An empty result is the only result that may proceed to migrate.

## Rollback

Use this when the index should come back off and the migration should be marked not applied.

```sql
DROP INDEX IF EXISTS migration_jobs_one_active_per_org_source;
```

Prisma records the directory name. Resolve that name:

```bash
prisma migrate resolve --rolled-back 20261112170000_migration_jobs_one_active_per_org_source --schema packages/db/prisma/schema.prisma
```

`20261112170000` is that migration. The resolve argument is the directory name above.

## Recovery when deploy already failed with P3018 / 23505

`P3018` is Prisma reporting that the migration failed. `23505` is Postgres `unique_violation` from this index. A failed `CREATE UNIQUE INDEX` runs in a transaction, so the index is not left behind.

1. Mark the failed attempt rolled back, using the same resolve command as above:
   ```bash
   prisma migrate resolve --rolled-back 20261112170000_migration_jobs_one_active_per_org_source --schema packages/db/prisma/schema.prisma
   ```
2. Run the precheck again. If it returns rows, **STOP**.
3. Duplicate cleanup happens only after Tony decides which rows to keep. This repo has no cleanup statement for those rows.
4. When the precheck returns no rows, run `prisma migrate deploy` again.

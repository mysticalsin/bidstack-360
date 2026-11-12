# Active import index — precheck, rollback, and a failed deploy

Migration `20261112170000_migration_jobs_one_active_per_org_source` adds `migration_jobs.file_hash` and unique index `migration_jobs_one_active_per_file`.

Same import means the same org, the same source, and the same uploaded file. `file_hash` is the sha256 of that file's rows. A different file is not the same import, including a file started by another user.

`CREATE UNIQUE INDEX` fails if one org already has more than one `PENDING` or `RUNNING` row for the same `CSV` or `SALESFORCE_CSV` file hash. This note does not delete or rewrite those rows.

Polo's live database is the Postgres inside the Cloudflare `polo-preview` container. Run this against the owner login, before `prisma migrate deploy`. The column has to exist before this query can run. A failed attempt of this migration rolls its column back with the index.

## Precheck (mandatory, read-only)

If the query returns any row, **STOP**. Do not run `prisma migrate deploy`.

```sql
SELECT org_id, source, file_hash, count(*) AS active
FROM migration_jobs
WHERE "status" IN ('PENDING', 'RUNNING')
  AND "source" IN ('CSV', 'SALESFORCE_CSV')
  AND "file_hash" IS NOT NULL
GROUP BY org_id, source, file_hash
HAVING count(*) > 1;
```

An empty result is the only result that may proceed to migrate.

## Rollback

Use this when the index and the file hash column should come back off, and the migration should be marked not applied.

```sql
DROP INDEX IF EXISTS migration_jobs_one_active_per_file;
ALTER TABLE migration_jobs DROP COLUMN IF EXISTS file_hash;
```

Prisma records the directory name. Resolve that name:

```bash
prisma migrate resolve --rolled-back 20261112170000_migration_jobs_one_active_per_org_source --schema packages/db/prisma/schema.prisma
```

`20261112170000` is that migration. The resolve argument is the directory name above.

## Recovery when deploy already failed with P3018 / 23505

`P3018` is Prisma reporting that the migration failed. `23505` is Postgres `unique_violation` from this index. A failed migration runs in a transaction, so the index and the new column are not left behind.

1. Mark the failed attempt rolled back, using the same resolve command as above:
   ```bash
   prisma migrate resolve --rolled-back 20261112170000_migration_jobs_one_active_per_org_source --schema packages/db/prisma/schema.prisma
   ```
2. Run the precheck again once `file_hash` exists. If it returns rows, **STOP**.
3. Duplicate cleanup happens only after Tony decides which rows to keep. This repo has no cleanup statement for those rows.
4. When the precheck returns no rows, run `prisma migrate deploy` again.

## Cloudflare boot loop

Polo production is the `polo-preview` Container. Postgres listens on `127.0.0.1` inside that container. The container disk is wiped on every restart. Boot restores the R2 object `polo-preview/latest.tgz`, then runs `prisma migrate deploy`. Redis is not in the snapshot, so a restored `PENDING` or `RUNNING` row has no live queue.

If that migration fails, the container stays in the failed phase and the site answers 503. The Worker cron destroys a failed container at most every 15 minutes. The next boot restores the same snapshot and the migration fails again.

Before `prisma migrate deploy`, the container runs the precheck above. The `WHERE` is the current index predicate: pending or running `CSV` or `SALESFORCE_CSV` rows with the same org, source, and file hash. A null file hash is not a duplicate. If the precheck returns rows, the container does not run that migration, does not change any row, and logs only the org id and the count. It then serves the restored schema instead of entering the failed phase, so the cron does not restart it.

### Revert the image

The container image is built with the Worker (`apps/polo-preview/wrangler.toml`, `image = "./container/Dockerfile"`). Roll the Worker back to the previous deployment. That image does not contain `20261112170000`, so its migrate does not try to create this index. Do not change Worker secrets as part of the rollback.

### Resolve the migration

A failed boot is not snapshotted. Snapshots are saved only after the container is ready, so the object restored on the next boot does not contain a failed `_prisma_migrations` row.

If a database you are repairing does contain a failed row for this migration:

```bash
prisma migrate resolve --rolled-back 20261112170000_migration_jobs_one_active_per_org_source --schema packages/db/prisma/schema.prisma
```

Then drop the index and `file_hash` with the statements in Rollback. Run the precheck. If it returns rows, stop. Deleting those rows is Tony's decision. This repo has no cleanup statement for them.

### Where the snapshot fits

`polo-preview/latest.tgz` is the database that comes back on boot. Daily copies are `polo-preview/daily/<date>.tgz`. The guard does not write a cleaned snapshot and does not delete the R2 object. Leave the snapshot in place: the previous image restores it and serves it. After the duplicate rows are removed and a ready container saves a new snapshot, the next boot can apply the migration.

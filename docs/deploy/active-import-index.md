# Active import index — precheck, rollback, and a failed deploy

Migration `20261112170000_migration_jobs_one_active_per_org_source` adds `migration_jobs.file_hash`.

Migration `20261112170100_migration_jobs_one_active_per_file` is the next file, and it is only this statement:

```sql
CREATE UNIQUE INDEX CONCURRENTLY "migration_jobs_one_active_per_file"
ON "migration_jobs" ("org_id", "source", "file_hash")
WHERE "status" IN ('PENDING', 'RUNNING')
  AND "source" IN ('CSV', 'SALESFORCE_CSV')
  AND "file_hash" IS NOT NULL;
```

Prisma runs that file outside a transaction because it is the only statement. Same import means the same org, the same source, and the same uploaded file. `file_hash` is the sha256 of that file's rows. A different file is not the same import, including a file started by another user.

`CREATE UNIQUE INDEX CONCURRENTLY` fails if one org already has more than one `PENDING` or `RUNNING` row for the same `CSV` or `SALESFORCE_CSV` file hash. This note does not delete or rewrite those rows. The column migration does not build the index, so it can apply while those rows exist.

Polo's live database is the Postgres inside the Cloudflare `polo-preview` container. Run the precheck against the owner login before the index migration. The column has to exist before this query can run.

## Precheck (mandatory, read-only)

If the query returns any row, do not apply `20261112170100_migration_jobs_one_active_per_file`. Leave the duplicate rows unchanged.

```sql
SELECT org_id, source, file_hash, count(*) AS active
FROM migration_jobs
WHERE "status" IN ('PENDING', 'RUNNING')
  AND "source" IN ('CSV', 'SALESFORCE_CSV')
  AND "file_hash" IS NOT NULL
GROUP BY org_id, source, file_hash
HAVING count(*) > 1;
```

An empty result is the only result that may create the index.

## Invalid index after CREATE INDEX CONCURRENTLY

If that statement fails, Postgres keeps `migration_jobs_one_active_per_file` with `pg_index.indisvalid = false`. Prisma records `20261112170100_migration_jobs_one_active_per_file` as failed. The next `prisma migrate deploy` is P3009 until both steps below have happened. Do not delete rows to make the next boot succeed.

Drop the invalid index as its own statement, outside a transaction:

```sql
DROP INDEX CONCURRENTLY IF EXISTS migration_jobs_one_active_per_file;
```

Then mark that failed migration rolled back. The column migration stays applied.

```bash
prisma migrate resolve --rolled-back 20261112170100_migration_jobs_one_active_per_file --schema packages/db/prisma/schema.prisma
```

`migrate resolve --rolled-back` on a migration that succeeded returns P3012 (`cannot be rolled back because it is not in a failed state`). Use it only for the failed attempt.

Run the precheck again. If it returns rows, do not retry the index migration. Deleting those rows is Tony's decision. This repo has no cleanup statement for them.

## Rollback

This is the failed-index recovery above, not a down migration. `20261112170000` only adds `file_hash`. Resolving that directory, or resolving the index migration after it succeeded, returns P3012. This repo does not add a migration to reverse a successful index.

## Live database check

`20261112170000_migration_jobs_one_active_per_org_source` on this branch only adds `file_hash`. It is not on `origin/main` or `origin/demo`, and the container image is built from main. Prisma 5.22 does not halt on a checksum mismatch. Do not add a repair migration for an older copy of that file.

Jarvis decides whether to run this read-only check. This change does not run it.

```sql
SELECT migration_name, checksum, finished_at, rolled_back_at, COUNT(*) OVER () AS row_count
FROM _prisma_migrations
WHERE migration_name LIKE '20261112170000%';
```

PROCEED only if (a) no row exists for `20261112170000` (never recorded), or (b) a row with checksum `d7e69f0c4edfd74990c47dde52dc8797225eb6314abcd415b7f44a227eaf9ee8` AND `finished_at` IS NOT NULL AND `rolled_back_at` IS NULL.

STOP and escalate to Tony in every other case, including:

- checksum `b4630ad8e436a1c4b945bf383a781c5864686387c18109fcc54958ee9b829833` (old index SQL). That database is not repaired by this head: `20261112170100` would fail with `42703` and then P3009. It needs a forward add-column migration before deploy. Do not drop an index and do not edit the checksum from this repo.
- current checksum with `finished_at` NULL (a failed attempt: recover per the P3009 notes)
- any other checksum
- more than one row

## Recovery when deploy already failed with P3018 / 23505

`P3018` is Prisma reporting that the migration failed. `23505` is Postgres `unique_violation` from this index. The index migration is not wrapped in a transaction, so a failed attempt leaves `indisvalid = false` and the next deploy is P3009. Drop it with `DROP INDEX CONCURRENTLY IF EXISTS migration_jobs_one_active_per_file`, then resolve the failed `20261112170100_migration_jobs_one_active_per_file`. Do not resolve a migration that succeeded: that is P3012.

1. Mark the failed index attempt rolled back, using the resolve command above.
2. Run the precheck again once `file_hash` exists. If it returns rows, do not retry the index migration.
3. Duplicate cleanup happens only after Tony decides which rows to keep. This repo has no cleanup statement for those rows.
4. When the precheck returns no rows, run `prisma migrate deploy` again.

## Cloudflare boot loop

Polo production is the `polo-preview` Container. Postgres listens on `127.0.0.1` inside that container. The container disk is wiped on every restart. Boot restores the R2 object `polo-preview/latest.tgz`, then runs `prisma migrate deploy`. Redis is not in the snapshot, so a restored `PENDING` or `RUNNING` row has no live queue.

If the index migration fails, the container stays in the failed phase and the site answers 503. The Worker cron destroys a failed container at most every 15 minutes. The next boot restores the same snapshot and the migration fails again.

Before `prisma migrate deploy`, the container runs the precheck above. The `WHERE` is the current index predicate: pending or running `CSV` or `SALESFORCE_CSV` rows with the same org, source, and file hash. A null file hash is not a duplicate. If the precheck returns rows, the container does not apply `20261112170100_migration_jobs_one_active_per_file`, does not change any row, and logs only the org id and the count. It still applies the other migrations, including the file hash column. If it cannot leave that index migration out, it serves the restored schema instead of entering the failed phase, so the cron does not restart it.

### Revert the image

The container image is built with the Worker (`apps/polo-preview/wrangler.toml`, `image = "./container/Dockerfile"`). Roll the Worker back to the previous deployment. That image does not contain `20261112170100`, so its migrate does not try to create this index. Do not change Worker secrets as part of the rollback.

### Resolve the migration

A failed boot is not snapshotted. Snapshots are saved only after the container is ready, so the object restored on the next boot does not contain a failed `_prisma_migrations` row.

If a database you are repairing does contain a failed row for the index migration, the index has `indisvalid = false` and a rerun is P3009. Drop it with `DROP INDEX CONCURRENTLY IF EXISTS migration_jobs_one_active_per_file`, then resolve only that failed migration. A migration that succeeded returns P3012:

```bash
prisma migrate resolve --rolled-back 20261112170100_migration_jobs_one_active_per_file --schema packages/db/prisma/schema.prisma
```

Run the precheck. If it returns rows, stop. Deleting those rows is Tony's decision. This repo has no cleanup statement for them.

### Where the snapshot fits

`polo-preview/latest.tgz` is the database that comes back on boot. Daily copies are `polo-preview/daily/<date>.tgz`. The guard does not write a cleaned snapshot and does not delete the R2 object. Leave the snapshot in place: the previous image restores it and serves it. After the duplicate rows are removed and a ready container saves a new snapshot, the next boot can apply the index migration.

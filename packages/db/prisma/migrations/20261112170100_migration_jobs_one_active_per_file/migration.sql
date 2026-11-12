-- Same import is one org, one source, and one uploaded file. This file is one
-- statement so Prisma runs it outside a transaction.

CREATE UNIQUE INDEX CONCURRENTLY "migration_jobs_one_active_per_file"
ON "migration_jobs" ("org_id", "source", "file_hash")
WHERE "status" IN ('PENDING', 'RUNNING')
  AND "source" IN ('CSV', 'SALESFORCE_CSV')
  AND "file_hash" IS NOT NULL;

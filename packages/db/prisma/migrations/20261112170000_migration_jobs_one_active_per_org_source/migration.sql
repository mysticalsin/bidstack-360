-- Same import is one org, one source, and one uploaded file. file_hash is the
-- sha256 of that file's rows. A second PENDING or RUNNING row for that triple
-- is a unique violation, which the start route returns as 409. A different
-- file, including one from another user, is not the same import. HubSpot
-- writes one RUNNING row per entity and stores no file hash, so those rows
-- are outside this index. COMPLETE, FAILED, and CANCELLED free the slot.
-- This migration has not been applied. The index is created here, not altered
-- from the earlier per-org shape.

ALTER TABLE "migration_jobs" ADD COLUMN "file_hash" TEXT;

CREATE UNIQUE INDEX "migration_jobs_one_active_per_file"
ON "migration_jobs" ("org_id", "source", "file_hash")
WHERE "status" IN ('PENDING', 'RUNNING')
  AND "source" IN ('CSV', 'SALESFORCE_CSV')
  AND "file_hash" IS NOT NULL;

-- Same import is one org, one source, and one uploaded file. file_hash is the
-- sha256 of that file's rows. The unique index is the next migration, so this
-- file stays a normal transactional ALTER.

ALTER TABLE "migration_jobs" ADD COLUMN "file_hash" TEXT;

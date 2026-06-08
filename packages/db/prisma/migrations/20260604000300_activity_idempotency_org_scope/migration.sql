-- Activity.idempotencyKey must be TENANT-scoped (review finding 2026-06-04).
-- The value is caller-supplied and the dedup read is org-scoped, but the unique
-- index was global — so one org reusing a key string (e.g. a shared external
-- event id) could block another org's activity write with a 409. Replace the
-- global unique with an org-scoped composite that matches the dedup read.

DROP INDEX IF EXISTS "activities_idempotency_key_key";

-- NULL idempotency_key rows are distinct under a unique index, so activities
-- without a key (the vast majority) remain unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS "activities_org_idempotency_key"
  ON "activities"("org_id", "idempotency_key");

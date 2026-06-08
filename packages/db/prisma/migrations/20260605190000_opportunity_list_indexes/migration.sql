-- Opportunity list views filter by org/deleted_at and sort by updated_at.
-- Without this composite index, the API can scan/sort enough rows to make
-- pipeline and opportunities tests hit the 15s timeout on warm local databases.
CREATE INDEX IF NOT EXISTS "opps_org_deleted_updated_idx"
  ON "opportunities"("org_id", "deleted_at", "updated_at" DESC);

-- Opportunity list cards batch-count comments by target and also filter out
-- deleted comments. Include deleted_at in the composite index so the aggregate
-- does not fall back to a wider target scan.
CREATE INDEX IF NOT EXISTS "comments_org_target_deleted_idx"
  ON "comments"("org_id", "target_type", "target_id", "deleted_at");

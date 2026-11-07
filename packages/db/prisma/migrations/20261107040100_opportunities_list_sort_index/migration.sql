-- Backs the default GET /opportunities sort (updated_at DESC, id DESC) and the
-- company search account scan. The older (org_id, deleted_at, updated_at) index
-- cannot serve the id tiebreaker, so the planner seq-scanned and sorted.
-- CONCURRENTLY keeps writes flowing; it must stay the only statement here.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "opps_org_list_sort_idx" ON "opportunities"("org_id", "updated_at" DESC, "id" DESC) WHERE "deleted_at" IS NULL;

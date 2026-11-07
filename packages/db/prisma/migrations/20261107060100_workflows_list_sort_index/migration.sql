-- Backs GET /workflows (updated_at DESC). No index served the sort.
-- CONCURRENTLY keeps writes flowing; it must stay the only statement here.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "workflows_org_list_sort_idx" ON "workflows"("org_id", "updated_at" DESC) WHERE "deleted_at" IS NULL;

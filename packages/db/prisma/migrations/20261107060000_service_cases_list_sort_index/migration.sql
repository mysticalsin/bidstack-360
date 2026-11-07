-- Backs GET /service-cases (created_at DESC, id DESC keyset). No index served
-- the sort, so the list sorted every live case in the org.
-- CONCURRENTLY keeps writes flowing; it must stay the only statement here.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "service_cases_org_list_sort_idx" ON "service_cases"("org_id", "created_at" DESC, "id" DESC) WHERE "deleted_at" IS NULL;

-- Backs the GET /leads cursor sort (score DESC, created_at DESC, id ASC).
-- CONCURRENTLY keeps lead writes flowing; it must stay the only statement here.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "leads_org_list_sort_idx" ON "leads"("org_id", "score" DESC, "created_at" DESC, "id");

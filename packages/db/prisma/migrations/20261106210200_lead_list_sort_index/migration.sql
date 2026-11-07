-- Backs the GET /leads cursor sort (score DESC, created_at DESC, id ASC).
CREATE INDEX "leads_org_list_sort_idx" ON "leads"("org_id", "score" DESC, "created_at" DESC, "id");

-- Trigram index for GET /search lead matches (first_name, last_name or
-- company_name ILIKE '%term%'); one multicolumn GIN serves each OR branch.
-- CONCURRENTLY keeps writes flowing; it must stay the only statement here.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "leads_search_trgm_idx" ON "leads" USING gin ("first_name" gin_trgm_ops, "last_name" gin_trgm_ops, "company_name" gin_trgm_ops);

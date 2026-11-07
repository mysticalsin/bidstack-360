-- Trigram index for GET /search contact matches (name or role ILIKE '%term%').
-- CONCURRENTLY keeps writes flowing; it must stay the only statement here.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "contacts_search_trgm_idx" ON "contacts" USING gin ("name" gin_trgm_ops, "role" gin_trgm_ops);

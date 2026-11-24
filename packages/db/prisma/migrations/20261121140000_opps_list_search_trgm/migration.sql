-- GET /opportunities?search= filters with Prisma OR of ILIKE on customer,
-- name, and code. opps_search_gin_idx only matches the concatenated
-- expression used by GET /search, so the list seq-scans the book.
-- CONCURRENTLY keeps writes flowing; it must stay the only statement here.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "opps_list_search_trgm_idx"
  ON "opportunities" USING gin ("customer" gin_trgm_ops, "name" gin_trgm_ops, "code" gin_trgm_ops);

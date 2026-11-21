-- Account search (GET /companies?search= and GET /search company tokens)
-- ILIKEs name, domain, industry, and legal_name. Contacts, leads, and tasks
-- already have trigram indexes; companies seq-scanned the book.
-- CONCURRENTLY keeps writes flowing; it must stay the only statement here.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "companies_search_trgm_idx"
  ON "companies" USING gin (
    "name" gin_trgm_ops,
    "legal_name" gin_trgm_ops,
    "domain" gin_trgm_ops,
    "industry" gin_trgm_ops
  );

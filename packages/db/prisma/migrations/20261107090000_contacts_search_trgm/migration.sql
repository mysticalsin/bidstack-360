-- GET /api/v1/contacts?search= ORs ILIKE '%term%' over name, customer and
-- role. A btree cannot serve a leading wildcard, so each predicate scanned
-- every contact in the org. Raw SQL because Prisma cannot declare trigram
-- operator classes; pg_trgm is already installed by the init migration.

CREATE INDEX IF NOT EXISTS contacts_name_trgm_idx ON contacts USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS contacts_customer_trgm_idx ON contacts USING gin (customer gin_trgm_ops);
CREATE INDEX IF NOT EXISTS contacts_role_trgm_idx ON contacts USING gin (role gin_trgm_ops);

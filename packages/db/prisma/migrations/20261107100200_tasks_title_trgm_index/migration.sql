-- Trigram index for GET /search task matches (title ILIKE '%term%').
-- CONCURRENTLY keeps writes flowing; it must stay the only statement here.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "tasks_title_trgm_idx" ON "tasks" USING gin ("title" gin_trgm_ops);

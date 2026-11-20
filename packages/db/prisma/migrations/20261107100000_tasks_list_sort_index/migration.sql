-- Backs the default GET /tasks sort (due_date ASC, created_at DESC, id ASC).
-- Without it the list seq-scans and sorts every live task in the org.
-- CONCURRENTLY keeps task writes flowing; it must stay the only statement here.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "tasks_org_list_sort_idx" ON "tasks"("org_id", "due_date", "created_at" DESC, "id") WHERE "deleted_at" IS NULL;

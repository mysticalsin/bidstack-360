-- Add missing B-tree indexes for high-cardinality filter columns
-- These support the in-memory filtering in buildDashboardSnapshot and report queries.

CREATE INDEX IF NOT EXISTS "opps_org_customer_idx" ON "opportunities"("org_id", "customer");
CREATE INDEX IF NOT EXISTS "contacts_org_customer_idx" ON "contacts"("org_id", "customer");
CREATE INDEX IF NOT EXISTS "tasks_org_assignee_idx" ON "tasks"("org_id", "assignee_id");

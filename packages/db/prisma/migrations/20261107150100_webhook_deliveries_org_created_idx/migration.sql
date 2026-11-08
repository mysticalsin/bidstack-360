-- Backs the delivery stats window scan. CONCURRENTLY keeps delivery writes
-- flowing; it must stay the only statement here.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "webhook_deliveries_org_created_idx" ON "webhook_deliveries"("org_id", "created_at");

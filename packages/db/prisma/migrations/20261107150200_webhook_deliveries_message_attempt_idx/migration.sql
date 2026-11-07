-- Backs the attempt list for one message. CONCURRENTLY keeps delivery writes
-- flowing; it must stay the only statement here.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "webhook_deliveries_message_attempt_idx" ON "webhook_deliveries"("message_id", "attempt");

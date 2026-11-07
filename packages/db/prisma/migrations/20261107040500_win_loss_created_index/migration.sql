-- Serves GET /win-loss/analysis: filter on (org_id, created_at range), order by created_at DESC.
CREATE INDEX IF NOT EXISTS "win_loss_records_org_created_idx" ON "win_loss_records"("org_id", "created_at" DESC);

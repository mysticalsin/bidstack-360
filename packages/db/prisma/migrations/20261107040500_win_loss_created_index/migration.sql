-- GET /win-loss/analysis filters win_loss_records on (org_id, created_at range)
-- and sorts by created_at DESC. Only (org_id, outcome, reason) and
-- (org_id, opportunity_id) existed, so Postgres sorted every org row per call.
CREATE INDEX IF NOT EXISTS "win_loss_records_org_created_idx" ON "win_loss_records"("org_id", "created_at" DESC);

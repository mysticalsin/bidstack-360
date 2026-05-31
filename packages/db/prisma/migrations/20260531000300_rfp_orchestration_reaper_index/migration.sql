-- Index supporting the RFP-orchestration stuck-run reaper
-- (apps/worker/src/queues/rfp-orchestrator.ts). The reaper sweeps
-- `WHERE state IN ('queued','running') AND updated_at < cutoff` every 5 minutes;
-- without this it is a sequential scan of rfp_orchestrations. Matches
-- @@index([state, updatedAt], map: "rfp_orchestrations_state_updated_idx") in
-- schema.prisma so `prisma migrate diff` reports no drift.
CREATE INDEX IF NOT EXISTS "rfp_orchestrations_state_updated_idx"
  ON "rfp_orchestrations" ("state", "updated_at");

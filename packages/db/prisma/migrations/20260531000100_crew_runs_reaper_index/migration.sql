-- Index supporting the crew-run stuck-run reaper (apps/worker/src/queues/crew-run.ts).
-- The reaper sweeps `WHERE status IN ('queued','running') AND created_at < cutoff`
-- every 5 minutes; without this it is a sequential scan of crew_runs.
-- Matches @@index([status, createdAt], map: "crew_runs_status_created_idx") in
-- schema.prisma so `prisma migrate diff` reports no drift.
CREATE INDEX IF NOT EXISTS "crew_runs_status_created_idx" ON "crew_runs" ("status", "created_at");

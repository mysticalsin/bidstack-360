-- I3: DB-level idempotency for the bid-deadline alert worker.
-- At most one alert per (org, user, dedupe url). PARTIAL — scoped to deadline
-- dedupe urls (`/opportunities/:id?deadline=:n`) so it never blocks other
-- notifications that may legitimately share a deep-link to the same entity.
-- Backs apps/worker/src/queues/bid-deadline-alerts.ts (alertIfNew catches P2002).
CREATE UNIQUE INDEX IF NOT EXISTS "notifications_deadline_dedupe_uq"
  ON "notifications" ("org_id", "user_id", "url")
  WHERE "url" LIKE '/opportunities/%?deadline=%';

-- At most one weekly whitespace digest per (org, user, week). Scoped to the
-- digest deep links so it never blocks other notifications. Backs
-- apps/worker/src/queues/msa-whitespace-digest.ts.
CREATE UNIQUE INDEX IF NOT EXISTS "notifications_msa_whitespace_digest_uq"
  ON "notifications" ("org_id", "user_id", "url")
  WHERE "url" LIKE '/agreements/whitespace?digest=%';

-- v21 account signals: watchdog news/funding/launch kinds plus importance,
-- dedupe, sentiment and an explicit Sample flag on account_watch_events.
ALTER TYPE "watchdog_event_kind" ADD VALUE IF NOT EXISTS 'FUNDING_ROUND';
ALTER TYPE "watchdog_event_kind" ADD VALUE IF NOT EXISTS 'PRODUCT_LAUNCH';
ALTER TYPE "watchdog_event_kind" ADD VALUE IF NOT EXISTS 'STRATEGIC_INITIATIVE';
ALTER TYPE "watchdog_event_kind" ADD VALUE IF NOT EXISTS 'HIRING_SPIKE';
ALTER TYPE "watchdog_event_kind" ADD VALUE IF NOT EXISTS 'LAYOFFS';
ALTER TYPE "watchdog_event_kind" ADD VALUE IF NOT EXISTS 'PARTNERSHIP';

ALTER TABLE "account_watch_events"
  ADD COLUMN "importance" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "dedupe_key" VARCHAR(64),
  ADD COLUMN "sentiment" DOUBLE PRECISION,
  ADD COLUMN "mentions" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "sample" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "account_watch_events"
  ADD CONSTRAINT "account_watch_events_importance_range" CHECK ("importance" BETWEEN 0 AND 100);

CREATE INDEX "account_watch_events_org_id_company_id_dedupe_key_idx"
  ON "account_watch_events" ("org_id", "company_id", "dedupe_key");
CREATE INDEX "account_watch_events_org_id_importance_occurred_at_idx"
  ON "account_watch_events" ("org_id", "importance" DESC, "occurred_at" DESC);

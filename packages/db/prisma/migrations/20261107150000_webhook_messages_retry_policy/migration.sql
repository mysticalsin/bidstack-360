-- Webhook message log, attempt detail, per-endpoint retry policy, secret
-- rotation overlap and targeted replay through the outbox (expand only).
CREATE TYPE "webhook_backoff_strategy" AS ENUM ('exponential', 'linear', 'fixed');

CREATE TYPE "webhook_message_status" AS ENUM ('pending', 'succeeded', 'failed');

ALTER TABLE "webhook_subscriptions" ADD COLUMN "max_attempts" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN "backoff_strategy" "webhook_backoff_strategy" NOT NULL DEFAULT 'exponential',
ADD COLUMN "backoff_base_seconds" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN "timeout_ms" INTEGER NOT NULL DEFAULT 10000,
ADD COLUMN "previous_secret" TEXT,
ADD COLUMN "previous_secret_expires_at" TIMESTAMPTZ(6);

ALTER TABLE "webhook_subscriptions" ADD CONSTRAINT "webhook_subs_retry_policy_bounds" CHECK (
  "max_attempts" BETWEEN 1 AND 10
  AND "backoff_base_seconds" BETWEEN 5 AND 3600
  AND "timeout_ms" BETWEEN 1000 AND 30000
);

CREATE TABLE "webhook_messages" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "event_timestamp" TIMESTAMPTZ(6) NOT NULL,
    "status" "webhook_message_status" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_status_code" INTEGER,
    "last_duration_ms" INTEGER,
    "replay_of_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "webhook_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "webhook_messages_org_created_idx" ON "webhook_messages"("org_id", "created_at" DESC, "id" DESC);

CREATE INDEX "webhook_messages_sub_created_idx" ON "webhook_messages"("subscription_id", "created_at" DESC);

ALTER TABLE "webhook_messages" ADD CONSTRAINT "webhook_messages_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "webhook_messages" ADD CONSTRAINT "webhook_messages_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "webhook_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "webhook_deliveries" ADD COLUMN "message_id" UUID,
ADD COLUMN "request_headers" JSONB,
ADD COLUMN "response_body" TEXT,
ADD COLUMN "response_truncated" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "webhook_deliveries_org_created_idx" ON "webhook_deliveries"("org_id", "created_at");

CREATE INDEX "webhook_deliveries_message_attempt_idx" ON "webhook_deliveries"("message_id", "attempt");

ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "webhook_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "webhook_outbox" ADD COLUMN "subscription_id" UUID,
ADD COLUMN "replay_of_id" UUID;

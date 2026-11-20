-- Durable webhook outbox with per-org idempotency keys (expand only, new table).
CREATE TYPE "webhook_outbox_status" AS ENUM ('pending', 'dispatched', 'dead');

CREATE TABLE "webhook_outbox" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "idempotency_key" VARCHAR(255) NOT NULL,
    "status" "webhook_outbox_status" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dispatched_at" TIMESTAMPTZ(6),

    CONSTRAINT "webhook_outbox_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "webhook_outbox_due_idx" ON "webhook_outbox"("status", "next_attempt_at");

CREATE UNIQUE INDEX "webhook_outbox_org_idempotency_key" ON "webhook_outbox"("org_id", "idempotency_key");

ALTER TABLE "webhook_outbox" ADD CONSTRAINT "webhook_outbox_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

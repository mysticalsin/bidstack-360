-- Comms capture: filing columns, per-owner calendar dedupe, create retry keys,
-- and Polo-only email drafts.

-- Calendar events: the old global (provider, external_id) key let one org's
-- pull overwrite another org's row, because Google shares an event id across
-- every attendee's calendar. Dedupe per owner instead.
DROP INDEX IF EXISTS "calendar_events_provider_external_key";

ALTER TABLE "calendar_events"
  ADD COLUMN "contact_id" UUID,
  ADD COLUMN "company_id" UUID,
  ADD COLUMN "opportunity_id" UUID,
  ADD COLUMN "client_request_id" VARCHAR(64);

CREATE UNIQUE INDEX "calendar_events_owner_external_key"
  ON "calendar_events"("org_id", "owner_id", "provider", "external_id");
CREATE UNIQUE INDEX "calendar_events_client_request_key"
  ON "calendar_events"("org_id", "owner_id", "client_request_id");
CREATE INDEX "calendar_events_org_id_company_id_start_at_idx"
  ON "calendar_events"("org_id", "company_id", "start_at");
CREATE INDEX "calendar_events_org_id_contact_id_start_at_idx"
  ON "calendar_events"("org_id", "contact_id", "start_at");

-- Email messages: file on contact, account and opportunity.
ALTER TABLE "email_messages"
  ADD COLUMN "contact_id" UUID,
  ADD COLUMN "company_id" UUID,
  ADD COLUMN "opportunity_id" UUID;

CREATE INDEX "email_messages_org_id_contact_id_received_at_idx"
  ON "email_messages"("org_id", "contact_id", "received_at" DESC);
CREATE INDEX "email_messages_org_id_company_id_received_at_idx"
  ON "email_messages"("org_id", "company_id", "received_at" DESC);
CREATE INDEX "email_messages_org_id_opportunity_id_received_at_idx"
  ON "email_messages"("org_id", "opportunity_id", "received_at" DESC);

-- Email drafts: composed in Polo, never sent by Polo.
CREATE TABLE "email_drafts" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "to_emails" JSONB NOT NULL DEFAULT '[]',
    "cc_emails" JSONB NOT NULL DEFAULT '[]',
    "subject" TEXT NOT NULL DEFAULT '',
    "body_text" TEXT,
    "thread_id" TEXT,
    "contact_id" UUID,
    "company_id" UUID,
    "opportunity_id" UUID,
    "client_request_id" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "email_drafts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "email_drafts_org_id_user_id_updated_at_idx" ON "email_drafts"("org_id", "user_id", "updated_at" DESC);
CREATE INDEX "email_drafts_org_id_contact_id_idx" ON "email_drafts"("org_id", "contact_id");
CREATE INDEX "email_drafts_org_id_company_id_idx" ON "email_drafts"("org_id", "company_id");
CREATE UNIQUE INDEX "email_drafts_client_request_key" ON "email_drafts"("org_id", "user_id", "client_request_id");

ALTER TABLE "email_drafts" ADD CONSTRAINT "email_drafts_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "email_drafts" ADD CONSTRAINT "email_drafts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

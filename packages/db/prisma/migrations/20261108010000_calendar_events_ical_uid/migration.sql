-- Several colleagues sync their own copy of one meeting. The shared calendar
-- identity lets the account timeline show that meeting once.
ALTER TABLE "calendar_events" ADD COLUMN "ical_uid" TEXT,
ADD COLUMN "is_private" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "owner_response" VARCHAR(32),
ADD COLUMN "meeting_channel" VARCHAR(32);

CREATE INDEX "calendar_events_org_id_ical_uid_idx" ON "calendar_events"("org_id", "ical_uid");

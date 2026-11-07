-- A user filed this event by hand; the provider pull never refiles it.
ALTER TABLE "calendar_events" ADD COLUMN "filed_manually" BOOLEAN NOT NULL DEFAULT false;

-- Create Activity and ActivityAttendee tables for unified activity/communication tracking

CREATE TYPE "activity_type" AS ENUM ('email', 'meeting', 'call', 'note', 'task');
CREATE TYPE "activity_status" AS ENUM ('planned', 'completed', 'cancelled');

CREATE TABLE "activities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "type" "activity_type" NOT NULL,
    "subject" TEXT,
    "description" TEXT,
    "start_time" TIMESTAMPTZ(6),
    "end_time" TIMESTAMPTZ(6),
    "status" "activity_status" NOT NULL DEFAULT 'planned',
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "owner_id" UUID,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "activities_org_entity_idx" ON "activities"("org_id", "entity_type", "entity_id");
CREATE INDEX "activities_org_type_idx" ON "activities"("org_id", "type");
CREATE INDEX "activities_org_start_idx" ON "activities"("org_id", "start_time");
CREATE INDEX "activities_org_owner_idx" ON "activities"("org_id", "owner_id");
CREATE INDEX "activities_deleted_at_idx" ON "activities"("deleted_at");

CREATE TABLE "activity_attendees" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "activity_id" UUID NOT NULL,
    "contact_id" UUID,
    "user_id" UUID,
    "email" TEXT,
    "response_status" TEXT NOT NULL DEFAULT 'needs_action',

    CONSTRAINT "activity_attendees_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "activity_attendees_activity_idx" ON "activity_attendees"("activity_id");
CREATE INDEX "activity_attendees_contact_idx" ON "activity_attendees"("contact_id");
CREATE INDEX "activity_attendees_user_idx" ON "activity_attendees"("user_id");

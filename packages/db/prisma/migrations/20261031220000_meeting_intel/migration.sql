-- Strategic account meeting intel (2026-10-31).
--
-- Meetings from ABC (org-level CRM sync), Metis (per-user consent-scoped
-- push from each user's second brain) and manual entry are normalized into
-- meeting_ingest_items, then the meeting-intel pipeline matches them to an
-- account and contacts, dedupes across sources (meeting_intel_sources keeps
-- every source and link) and raises cross-region flags on strategic accounts.
-- Raw transcripts are stored only when the connecting user allows it.
--
-- meetings:read / meetings:write follow kam:read / kam:write on every role
-- (strategic accounts are the KAM surface). Incremental only; idempotent data
-- inserts (ON CONFLICT DO NOTHING) so a revoked grant is never revived.

-- CreateEnum
CREATE TYPE "meeting_intel_source" AS ENUM ('abc', 'metis', 'manual');

-- CreateEnum
CREATE TYPE "meeting_intel_visibility" AS ENUM ('account_team', 'org');

-- CreateEnum
CREATE TYPE "seniority_level" AS ENUM ('c_level', 'vp', 'director', 'manager', 'ic', 'unknown');

-- CreateEnum
CREATE TYPE "meeting_ingest_status" AS ENUM ('pending', 'processed', 'unmatched', 'skipped', 'error');

-- CreateTable
CREATE TABLE "meeting_source_connections" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "source" "meeting_intel_source" NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'connected',
    "share_summary" BOOLEAN NOT NULL DEFAULT true,
    "share_transcript" BOOLEAN NOT NULL DEFAULT false,
    "token_hash" VARCHAR(64),
    "token_prefix" VARCHAR(16),
    "consented_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "last_sync_at" TIMESTAMPTZ(6),
    "last_error" TEXT,
    "items_received" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "meeting_source_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_ingest_items" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "source" "meeting_intel_source" NOT NULL,
    "external_id" TEXT NOT NULL,
    "connection_id" UUID,
    "submitted_by_id" UUID,
    "payload" JSONB NOT NULL,
    "status" "meeting_ingest_status" NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "meeting_intel_id" UUID,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(6),

    CONSTRAINT "meeting_ingest_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_intel" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "held_at" TIMESTAMPTZ(6) NOT NULL,
    "visibility" "meeting_intel_visibility" NOT NULL DEFAULT 'account_team',
    "summary" TEXT,
    "transcript_text" TEXT,
    "challenges" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "similar_projects" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "opportunities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "next_steps" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "dedupe_key" VARCHAR(64) NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "meeting_intel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_intel_sources" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "meeting_id" UUID NOT NULL,
    "source" "meeting_intel_source" NOT NULL,
    "external_id" TEXT NOT NULL,
    "url" TEXT,
    "connection_user_id" UUID,
    "ingested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meeting_intel_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_intel_attendees" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "meeting_id" UUID NOT NULL,
    "contact_id" UUID,
    "user_id" UUID,
    "name" TEXT NOT NULL,
    "email" CITEXT,
    "title" TEXT,
    "seniority" "seniority_level" NOT NULL DEFAULT 'unknown',
    "region" TEXT,
    "business_unit" TEXT,
    "is_internal" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "meeting_intel_attendees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_cross_region_flags" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "meeting_id" UUID NOT NULL,
    "recipient_user_id" UUID NOT NULL,
    "parent_company_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "owned_company_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "talking_points" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dismissed_at" TIMESTAMPTZ(6),

    CONSTRAINT "meeting_cross_region_flags_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "meeting_source_connections_token_hash_key" ON "meeting_source_connections"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_source_connections_org_id_user_id_source_key" ON "meeting_source_connections"("org_id", "user_id", "source");

-- CreateIndex
CREATE INDEX "meeting_ingest_items_org_id_status_received_at_idx" ON "meeting_ingest_items"("org_id", "status", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_ingest_items_org_id_source_external_id_key" ON "meeting_ingest_items"("org_id", "source", "external_id");

-- CreateIndex
CREATE INDEX "meeting_intel_org_id_company_id_held_at_idx" ON "meeting_intel"("org_id", "company_id", "held_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "meeting_intel_org_id_dedupe_key_key" ON "meeting_intel"("org_id", "dedupe_key");

-- CreateIndex
CREATE INDEX "meeting_intel_sources_meeting_id_idx" ON "meeting_intel_sources"("meeting_id");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_intel_sources_org_id_source_external_id_key" ON "meeting_intel_sources"("org_id", "source", "external_id");

-- CreateIndex
CREATE INDEX "meeting_intel_attendees_meeting_id_idx" ON "meeting_intel_attendees"("meeting_id");

-- CreateIndex
CREATE INDEX "meeting_intel_attendees_org_id_contact_id_idx" ON "meeting_intel_attendees"("org_id", "contact_id");

-- CreateIndex
CREATE INDEX "meeting_cross_region_flags_org_id_recipient_user_id_status__idx" ON "meeting_cross_region_flags"("org_id", "recipient_user_id", "status", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "meeting_cross_region_flags_meeting_id_recipient_user_id_own_key" ON "meeting_cross_region_flags"("meeting_id", "recipient_user_id", "owned_company_id");

-- AddForeignKey
ALTER TABLE "meeting_source_connections" ADD CONSTRAINT "meeting_source_connections_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_source_connections" ADD CONSTRAINT "meeting_source_connections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_ingest_items" ADD CONSTRAINT "meeting_ingest_items_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_intel" ADD CONSTRAINT "meeting_intel_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_intel" ADD CONSTRAINT "meeting_intel_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_intel_sources" ADD CONSTRAINT "meeting_intel_sources_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meeting_intel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_intel_attendees" ADD CONSTRAINT "meeting_intel_attendees_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meeting_intel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_intel_attendees" ADD CONSTRAINT "meeting_intel_attendees_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_cross_region_flags" ADD CONSTRAINT "meeting_cross_region_flags_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meeting_intel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Permissions (global keys).
INSERT INTO "permissions" ("id", "key", "name", "description") VALUES
  (gen_random_uuid(), 'meetings:read', 'Read meeting intel', 'View strategic account meeting intel, coverage map, challenge rollup and cross-region flags.'),
  (gen_random_uuid(), 'meetings:write', 'Manage meeting intel', 'Enter meetings manually, connect meeting sources, change visibility and dismiss flags.')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "org_id")
SELECT rp."role_id", m."id", rp."org_id"
FROM "role_permissions" rp
JOIN "permissions" k ON k."id" = rp."permission_id"
JOIN "permissions" m ON (k."key" = 'kam:read' AND m."key" = 'meetings:read')
                     OR (k."key" = 'kam:write' AND m."key" = 'meetings:write')
WHERE rp."deleted_at" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

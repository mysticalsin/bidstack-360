-- KAM (Key Account Management) front layer — foundation (Slice 0).
-- Additive only: new enums, 6 KAM tables, Company + Task columns.
-- Initiative→Lead→Opportunity→Dropped feeds the existing Opportunity pipeline
-- (OM is NOT rebuilt). All KAM entities FK to companies(id). Idempotent.
-- See docs/KAM-PLAN.md.

-- ─── Enums ───────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "initiative_stage" AS ENUM ('initiative', 'lead', 'opportunity', 'dropped');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "kam_account_status" AS ENUM ('identified', 'kickoff', 'mapped', 'active', 'paused', 'closed');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "kam_owner_model" AS ENUM ('presales_driven', 'manager_driven');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "kam_session_source" AS ENUM ('manual_paste', 'manual_upload', 'sharepoint_pull', 'call_recording', 'dust_push');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "kam_draft_status" AS ENUM ('pending', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "kam_handoff_status" AS ENUM ('draft', 'exported', 'confirmed');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ─── Company additive columns ────────────────────────────────────────────────
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "kam_status" "kam_account_status" NOT NULL DEFAULT 'identified';
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "kam_owner_model" "kam_owner_model";
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "director_sponsor_id" UUID;

-- ─── kam_consultants ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "kam_consultants" (
  "id"               UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id"           UUID NOT NULL,
  "company_id"       UUID NOT NULL,
  "name"             TEXT NOT NULL,
  "department"       TEXT,
  "switched_on"      BOOLEAN NOT NULL DEFAULT false,
  "engagement_notes" TEXT,
  "contact_id"       UUID,
  "email"            CITEXT,
  "email_hash"       VARCHAR(64),
  "ai_opt_out"       BOOLEAN NOT NULL DEFAULT false,
  "created_by_id"    UUID,
  "created_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"       TIMESTAMPTZ(6) NOT NULL,
  "deleted_at"       TIMESTAMPTZ(6),
  CONSTRAINT "kam_consultants_pkey" PRIMARY KEY ("id")
);

-- ─── kam_sessions ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "kam_sessions" (
  "id"                    UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id"                UUID NOT NULL,
  "company_id"            UUID NOT NULL,
  "title"                 TEXT,
  "held_at"               TIMESTAMPTZ(6) NOT NULL,
  "source_type"           "kam_session_source" NOT NULL,
  "source_ref"            TEXT,
  "attendees"             TEXT[] NOT NULL DEFAULT '{}',
  "consultant_ids"        TEXT[] NOT NULL DEFAULT '{}',
  "transcript_text"       TEXT,
  "transcript_structured" JSONB,
  "ai_note"               JSONB,
  "ai_note_status"        "kam_draft_status" NOT NULL DEFAULT 'pending',
  "committed_at"          TIMESTAMPTZ(6),
  "created_by_id"         UUID,
  "created_at"            TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"            TIMESTAMPTZ(6) NOT NULL,
  "deleted_at"            TIMESTAMPTZ(6),
  CONSTRAINT "kam_sessions_pkey" PRIMARY KEY ("id")
);

-- ─── kam_initiatives ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "kam_initiatives" (
  "id"                          UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id"                      UUID NOT NULL,
  "company_id"                  UUID NOT NULL,
  "session_id"                  UUID,
  "title"                       TEXT NOT NULL,
  "description"                 TEXT,
  "stage"                       "initiative_stage" NOT NULL DEFAULT 'initiative',
  "owner_id"                    UUID,
  "priority"                    "lead_priority" NOT NULL DEFAULT 'medium',
  "estimated_value_micros"      BIGINT,
  "last_activity_at"            TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "dropped_reason"              TEXT,
  "converted_to_opportunity_id" UUID,
  "created_by_id"               UUID,
  "created_at"                  TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"                  TIMESTAMPTZ(6) NOT NULL,
  "deleted_at"                  TIMESTAMPTZ(6),
  CONSTRAINT "kam_initiatives_pkey" PRIMARY KEY ("id")
);

-- ─── kam_session_drafts ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "kam_session_drafts" (
  "id"                UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id"            UUID NOT NULL,
  "company_id"        UUID NOT NULL,
  "session_id"        UUID NOT NULL,
  "status"            "kam_draft_status" NOT NULL DEFAULT 'pending',
  "source"            TEXT NOT NULL DEFAULT 'manual',
  "note_draft"        JSONB NOT NULL DEFAULT '{}',
  "task_drafts"       JSONB NOT NULL DEFAULT '[]',
  "initiative_drafts" JSONB NOT NULL DEFAULT '[]',
  "low_confidence"    JSONB NOT NULL DEFAULT '[]',
  "confidence_bps"    INTEGER,
  "warnings"          JSONB NOT NULL DEFAULT '[]',
  "created_by_id"     UUID,
  "reviewed_by_id"    UUID,
  "reviewed_at"       TIMESTAMPTZ(6),
  "created_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"        TIMESTAMPTZ(6) NOT NULL,
  "deleted_at"        TIMESTAMPTZ(6),
  CONSTRAINT "kam_session_drafts_pkey" PRIMARY KEY ("id")
);

-- ─── kam_handoffs ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "kam_handoffs" (
  "id"             UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id"         UUID NOT NULL,
  "company_id"     UUID NOT NULL,
  "initiative_id"  UUID NOT NULL,
  "opportunity_id" UUID,
  "status"         "kam_handoff_status" NOT NULL DEFAULT 'draft',
  "target_system"  TEXT NOT NULL DEFAULT 'abc_om',
  "export_payload" JSONB NOT NULL DEFAULT '{}',
  "external_ref"   TEXT,
  "exported_at"    TIMESTAMPTZ(6),
  "exported_by_id" UUID,
  "created_by_id"  UUID,
  "created_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"     TIMESTAMPTZ(6) NOT NULL,
  "deleted_at"     TIMESTAMPTZ(6),
  CONSTRAINT "kam_handoffs_pkey" PRIMARY KEY ("id")
);

-- ─── kam_prospections (read-mirror of ABC; NOT a tracker) ────────────────────
CREATE TABLE IF NOT EXISTS "kam_prospections" (
  "id"                   UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id"               UUID NOT NULL,
  "company_id"           UUID,
  "owner_id"             UUID,
  "external_id"          TEXT,
  "action_type"          TEXT NOT NULL,
  "occurred_at"          TIMESTAMPTZ(6) NOT NULL,
  "linked_task_id"       UUID,
  "linked_initiative_id" UUID,
  "source"               TEXT NOT NULL DEFAULT 'abc',
  "sync_batch_id"        TEXT,
  "synced_at"            TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "created_at"           TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "deleted_at"           TIMESTAMPTZ(6),
  CONSTRAINT "kam_prospections_pkey" PRIMARY KEY ("id")
);

-- ─── Task additive columns ───────────────────────────────────────────────────
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "initiative_id" UUID;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "account_id" UUID;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "type" TEXT;

-- ─── Indexes ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "kam_consultants_org_company_switched_idx" ON "kam_consultants" ("org_id", "company_id", "switched_on");
CREATE INDEX IF NOT EXISTS "kam_consultants_org_email_hash_idx" ON "kam_consultants" ("org_id", "email_hash");
CREATE INDEX IF NOT EXISTS "kam_consultants_deleted_at_idx" ON "kam_consultants" ("deleted_at");

CREATE INDEX IF NOT EXISTS "kam_sessions_org_company_held_idx" ON "kam_sessions" ("org_id", "company_id", "held_at" DESC);
CREATE INDEX IF NOT EXISTS "kam_sessions_deleted_at_idx" ON "kam_sessions" ("deleted_at");

CREATE INDEX IF NOT EXISTS "kam_initiatives_org_company_stage_idx" ON "kam_initiatives" ("org_id", "company_id", "stage");
CREATE INDEX IF NOT EXISTS "kam_initiatives_org_stage_activity_idx" ON "kam_initiatives" ("org_id", "stage", "last_activity_at");
CREATE INDEX IF NOT EXISTS "kam_initiatives_org_owner_idx" ON "kam_initiatives" ("org_id", "owner_id");
CREATE INDEX IF NOT EXISTS "kam_initiatives_converted_to_opportunity_id_idx" ON "kam_initiatives" ("converted_to_opportunity_id");
CREATE INDEX IF NOT EXISTS "kam_initiatives_deleted_at_idx" ON "kam_initiatives" ("deleted_at");

CREATE INDEX IF NOT EXISTS "kam_session_drafts_org_company_status_idx" ON "kam_session_drafts" ("org_id", "company_id", "status");
CREATE INDEX IF NOT EXISTS "kam_session_drafts_org_session_idx" ON "kam_session_drafts" ("org_id", "session_id");
CREATE INDEX IF NOT EXISTS "kam_session_drafts_deleted_at_idx" ON "kam_session_drafts" ("deleted_at");

CREATE UNIQUE INDEX IF NOT EXISTS "kam_handoffs_initiative_id_key" ON "kam_handoffs" ("initiative_id");
CREATE INDEX IF NOT EXISTS "kam_handoffs_org_company_idx" ON "kam_handoffs" ("org_id", "company_id");
CREATE INDEX IF NOT EXISTS "kam_handoffs_org_status_idx" ON "kam_handoffs" ("org_id", "status");
CREATE INDEX IF NOT EXISTS "kam_handoffs_deleted_at_idx" ON "kam_handoffs" ("deleted_at");

CREATE UNIQUE INDEX IF NOT EXISTS "kam_prospections_org_source_external_key" ON "kam_prospections" ("org_id", "source", "external_id");
CREATE INDEX IF NOT EXISTS "kam_prospections_org_company_idx" ON "kam_prospections" ("org_id", "company_id");
CREATE INDEX IF NOT EXISTS "kam_prospections_org_owner_idx" ON "kam_prospections" ("org_id", "owner_id");
CREATE INDEX IF NOT EXISTS "kam_prospections_deleted_at_idx" ON "kam_prospections" ("deleted_at");

CREATE INDEX IF NOT EXISTS "tasks_org_initiative_idx" ON "tasks" ("org_id", "initiative_id");
CREATE INDEX IF NOT EXISTS "tasks_org_account_status_due_idx" ON "tasks" ("org_id", "account_id", "status", "due_date");

-- ─── Foreign keys ────────────────────────────────────────────────────────────
ALTER TABLE "kam_consultants"     ADD CONSTRAINT "kam_consultants_org_fk"     FOREIGN KEY ("org_id")     REFERENCES "orgs" ("id")      ON DELETE CASCADE  ON UPDATE CASCADE;
ALTER TABLE "kam_consultants"     ADD CONSTRAINT "kam_consultants_company_fk" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE CASCADE  ON UPDATE CASCADE;

ALTER TABLE "kam_sessions"        ADD CONSTRAINT "kam_sessions_org_fk"        FOREIGN KEY ("org_id")     REFERENCES "orgs" ("id")      ON DELETE CASCADE  ON UPDATE CASCADE;
ALTER TABLE "kam_sessions"        ADD CONSTRAINT "kam_sessions_company_fk"    FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE CASCADE  ON UPDATE CASCADE;

ALTER TABLE "kam_initiatives"     ADD CONSTRAINT "kam_initiatives_org_fk"     FOREIGN KEY ("org_id")     REFERENCES "orgs" ("id")      ON DELETE CASCADE  ON UPDATE CASCADE;
ALTER TABLE "kam_initiatives"     ADD CONSTRAINT "kam_initiatives_company_fk" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE CASCADE  ON UPDATE CASCADE;
ALTER TABLE "kam_initiatives"     ADD CONSTRAINT "kam_initiatives_session_fk" FOREIGN KEY ("session_id") REFERENCES "kam_sessions" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "kam_session_drafts"  ADD CONSTRAINT "kam_session_drafts_org_fk"     FOREIGN KEY ("org_id")     REFERENCES "orgs" ("id")         ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "kam_session_drafts"  ADD CONSTRAINT "kam_session_drafts_company_fk" FOREIGN KEY ("company_id") REFERENCES "companies" ("id")    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "kam_session_drafts"  ADD CONSTRAINT "kam_session_drafts_session_fk" FOREIGN KEY ("session_id") REFERENCES "kam_sessions" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "kam_handoffs"        ADD CONSTRAINT "kam_handoffs_org_fk"        FOREIGN KEY ("org_id")        REFERENCES "orgs" ("id")            ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "kam_handoffs"        ADD CONSTRAINT "kam_handoffs_company_fk"    FOREIGN KEY ("company_id")    REFERENCES "companies" ("id")       ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "kam_handoffs"        ADD CONSTRAINT "kam_handoffs_initiative_fk" FOREIGN KEY ("initiative_id") REFERENCES "kam_initiatives" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "kam_prospections"    ADD CONSTRAINT "kam_prospections_org_fk"     FOREIGN KEY ("org_id")     REFERENCES "orgs" ("id")      ON DELETE CASCADE  ON UPDATE CASCADE;
ALTER TABLE "kam_prospections"    ADD CONSTRAINT "kam_prospections_company_fk" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "tasks" ADD CONSTRAINT "tasks_initiative_fk" FOREIGN KEY ("initiative_id") REFERENCES "kam_initiatives" ("id") ON DELETE CASCADE  ON UPDATE CASCADE;
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_account_fk"    FOREIGN KEY ("account_id")    REFERENCES "companies" ("id")       ON DELETE SET NULL ON UPDATE CASCADE;

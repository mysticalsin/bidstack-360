-- Sprint 1 — Krayin import: Tags, EmailTemplates, Lead rot tracking.
-- Adds new tables + extends WorkflowActionKind + adds Lead.statusChangedAt.

-- Extend the WorkflowActionKind enum with the four new action kinds wired
-- in apps/api/src/routes/workflows.ts.
ALTER TYPE "workflow_action_kind" ADD VALUE IF NOT EXISTS 'add_tag';
ALTER TYPE "workflow_action_kind" ADD VALUE IF NOT EXISTS 'remove_tag';
ALTER TYPE "workflow_action_kind" ADD VALUE IF NOT EXISTS 'add_note_as_activity';
ALTER TYPE "workflow_action_kind" ADD VALUE IF NOT EXISTS 'send_email_to_owner';

-- Lead: track the moment of the last status mutation so the kanban
-- "Rotten Days" badge has an accurate clock. Backfill existing rows from
-- their created_at so the badge doesn't fire false-positives on day one.
ALTER TABLE "leads"
  ADD COLUMN IF NOT EXISTS "status_changed_at" TIMESTAMPTZ NOT NULL DEFAULT now();

UPDATE "leads" SET "status_changed_at" = "created_at" WHERE "status_changed_at" = now();

CREATE INDEX IF NOT EXISTS "leads_org_id_status_status_changed_at_idx"
  ON "leads" ("org_id", "status", "status_changed_at");

-- ─── Tags ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "tags" (
  "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"         UUID NOT NULL,
  "name"           CITEXT NOT NULL,
  "color"          TEXT NOT NULL DEFAULT '#A78BFA',
  "created_by_id"  UUID,
  "created_at"     TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"     TIMESTAMPTZ NOT NULL DEFAULT now(),
  "deleted_at"     TIMESTAMPTZ,
  CONSTRAINT "tags_org_fk"        FOREIGN KEY ("org_id")        REFERENCES "orgs"("id")  ON DELETE CASCADE,
  CONSTRAINT "tags_created_by_fk" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "tags_org_id_name_key"  ON "tags" ("org_id", "name");
CREATE INDEX        IF NOT EXISTS "tags_org_id_idx"       ON "tags" ("org_id");
CREATE INDEX        IF NOT EXISTS "tags_deleted_at_idx"   ON "tags" ("deleted_at");

CREATE TABLE IF NOT EXISTS "entity_tags" (
  "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"        UUID NOT NULL,
  "tag_id"        UUID NOT NULL,
  "entity_type"   TEXT NOT NULL,
  "entity_id"     UUID NOT NULL,
  "tagged_by_id"  UUID,
  "tagged_at"     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "entity_tags_org_fk"        FOREIGN KEY ("org_id")       REFERENCES "orgs"("id")  ON DELETE CASCADE,
  CONSTRAINT "entity_tags_tag_fk"        FOREIGN KEY ("tag_id")       REFERENCES "tags"("id")  ON DELETE CASCADE,
  CONSTRAINT "entity_tags_tagged_by_fk"  FOREIGN KEY ("tagged_by_id") REFERENCES "users"("id") ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "entity_tags_org_id_tag_id_entity_type_entity_id_key"
  ON "entity_tags" ("org_id", "tag_id", "entity_type", "entity_id");
CREATE INDEX IF NOT EXISTS "entity_tags_org_id_entity_type_entity_id_idx"
  ON "entity_tags" ("org_id", "entity_type", "entity_id");
CREATE INDEX IF NOT EXISTS "entity_tags_org_id_tag_id_idx"
  ON "entity_tags" ("org_id", "tag_id");

-- ─── Email templates ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "email_templates" (
  "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"         UUID NOT NULL,
  "name"           TEXT NOT NULL,
  "subject"        TEXT NOT NULL,
  "body_html"      TEXT NOT NULL,
  "body_text"      TEXT,
  "category"       TEXT,
  "archived"       BOOLEAN NOT NULL DEFAULT false,
  "created_by_id"  UUID,
  "use_count"      INTEGER NOT NULL DEFAULT 0,
  "last_used_at"   TIMESTAMPTZ,
  "created_at"     TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"     TIMESTAMPTZ NOT NULL DEFAULT now(),
  "deleted_at"     TIMESTAMPTZ,
  CONSTRAINT "email_templates_org_fk"        FOREIGN KEY ("org_id")        REFERENCES "orgs"("id")  ON DELETE CASCADE,
  CONSTRAINT "email_templates_created_by_fk" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "email_templates_org_id_name_key" ON "email_templates" ("org_id", "name");
CREATE INDEX        IF NOT EXISTS "email_templates_org_id_archived_idx" ON "email_templates" ("org_id", "archived");
CREATE INDEX        IF NOT EXISTS "email_templates_deleted_at_idx"      ON "email_templates" ("deleted_at");

-- ─── Lead stage rot config ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "lead_stage_rot_config" (
  "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id"       UUID NOT NULL,
  "status"       "lead_status" NOT NULL,
  "rotten_days"  INTEGER NOT NULL DEFAULT 14,
  "created_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "lead_stage_rot_config_org_fk" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "lead_stage_rot_config_org_id_status_key"
  ON "lead_stage_rot_config" ("org_id", "status");

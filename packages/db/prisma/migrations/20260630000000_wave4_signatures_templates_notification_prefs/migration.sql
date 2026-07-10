-- Wave 4 backfill: e-signature, document templates, and notification prefs.
--
-- WHY: the SignatureRequest / SignatureEvent / DocumentTemplate /
-- DocumentTemplateVersion / NotificationPref models (plus their enums) shipped in
-- schema.prisma — and in the generated client and the seed — but no migration ever
-- created their tables/enums. `prisma migrate deploy` therefore produced a database
-- the seed (prisma.signatureRequest.upsert) and the /signatures, /document-templates
-- and notification routes could not use, failing with P2021 (table missing). This
-- migration backfills EXACTLY those objects to match schema.prisma. Every statement
-- is guarded (DO / IF NOT EXISTS, per this repo's existing migration convention) so
-- it is a safe no-op on any database that already carries these objects from an
-- out-of-band `prisma db push`.

-- CreateEnum (guarded — CREATE TYPE has no IF NOT EXISTS)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'signature_provider') THEN
    CREATE TYPE "signature_provider" AS ENUM ('DOCUSIGN', 'INTERNAL');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'signature_status') THEN
    CREATE TYPE "signature_status" AS ENUM ('DRAFT', 'SENT', 'VIEWED', 'SIGNED', 'DECLINED', 'VOIDED', 'EXPIRED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'signature_event_type') THEN
    CREATE TYPE "signature_event_type" AS ENUM ('SENT', 'VIEWED', 'SIGNED', 'DECLINED', 'DELIVERED', 'VOIDED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'template_kind') THEN
    CREATE TYPE "template_kind" AS ENUM ('QUOTE', 'MSA', 'SOW', 'NDA', 'PROPOSAL', 'CUSTOM');
  END IF;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "document_templates" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "template_kind" NOT NULL,
    "description" TEXT,
    "body_html" TEXT NOT NULL,
    "default_variables" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    CONSTRAINT "document_templates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "document_template_versions" (
    "id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "body_html" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    CONSTRAINT "document_template_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "notification_prefs" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "email_digest" BOOLEAN NOT NULL DEFAULT true,
    "mention_push" BOOLEAN NOT NULL DEFAULT true,
    "task_due_soon" BOOLEAN NOT NULL DEFAULT true,
    "deal_stage_change" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "notification_prefs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "signature_requests" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "provider" "signature_provider" NOT NULL DEFAULT 'DOCUSIGN',
    "provider_request_id" TEXT,
    "status" "signature_status" NOT NULL DEFAULT 'DRAFT',
    "recipients" JSONB NOT NULL,
    "sent_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "voided_at" TIMESTAMPTZ(6),
    "void_reason" TEXT,
    "completed_document_s3_key" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    CONSTRAINT "signature_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "signature_events" (
    "id" UUID NOT NULL,
    "signature_request_id" UUID NOT NULL,
    "type" "signature_event_type" NOT NULL,
    "recipient_email" TEXT,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    CONSTRAINT "signature_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "document_templates_deleted_at_idx" ON "document_templates" ("deleted_at");
CREATE INDEX IF NOT EXISTS "document_templates_org_id_idx" ON "document_templates" ("org_id");
CREATE INDEX IF NOT EXISTS "document_templates_org_id_kind_idx" ON "document_templates" ("org_id", "kind");

CREATE INDEX IF NOT EXISTS "document_template_versions_template_id_idx" ON "document_template_versions" ("template_id");
CREATE UNIQUE INDEX IF NOT EXISTS "document_template_versions_template_id_version_key" ON "document_template_versions" ("template_id", "version");

CREATE INDEX IF NOT EXISTS "notification_prefs_org_id_idx" ON "notification_prefs" ("org_id");
CREATE UNIQUE INDEX IF NOT EXISTS "notification_prefs_user_id_key" ON "notification_prefs" ("user_id");

CREATE INDEX IF NOT EXISTS "signature_requests_deleted_at_idx" ON "signature_requests" ("deleted_at");
CREATE INDEX IF NOT EXISTS "signature_requests_org_id_idx" ON "signature_requests" ("org_id");
CREATE INDEX IF NOT EXISTS "signature_requests_org_id_document_id_idx" ON "signature_requests" ("org_id", "document_id");
CREATE INDEX IF NOT EXISTS "signature_requests_org_id_status_idx" ON "signature_requests" ("org_id", "status");

CREATE INDEX IF NOT EXISTS "signature_events_signature_request_id_idx" ON "signature_events" ("signature_request_id");
CREATE INDEX IF NOT EXISTS "signature_events_signature_request_id_occurred_at_idx" ON "signature_events" ("signature_request_id", "occurred_at");

-- Slice 13a: agreement pull sources (SharePoint via Graph, DocuSign) and the
-- durable inbound queue shared by every ingest channel (sync, REST, MCP).

-- CreateTable
CREATE TABLE "agreement_sources" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB NOT NULL DEFAULT '{}',
    "cursor" TEXT,
    "last_sync_at" TIMESTAMPTZ(6),
    "last_run_id" VARCHAR(80),
    "last_result" JSONB,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "agreement_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agreement_ingest_items" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "source_id" UUID,
    "channel" VARCHAR(20) NOT NULL,
    "external_source" VARCHAR(120) NOT NULL,
    "external_id" VARCHAR(300) NOT NULL,
    "external_version" VARCHAR(200),
    "idempotency_key" VARCHAR(128),
    "file_name" VARCHAR(255) NOT NULL,
    "content_type" VARCHAR(100),
    "bytes" INTEGER,
    "sha256" VARCHAR(64),
    "file_url" VARCHAR(2000),
    "pending_content" BYTEA,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "status" VARCHAR(20) NOT NULL DEFAULT 'queued',
    "error" VARCHAR(500),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "intake_draft_id" UUID,
    "contract_id" UUID,
    "contract_file_version_id" UUID,
    "actor_type" VARCHAR(20) NOT NULL,
    "actor_id" VARCHAR(80),
    "processed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "agreement_ingest_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agreement_sources_org_kind_idx" ON "agreement_sources"("org_id", "kind");

-- CreateIndex
CREATE INDEX "agreement_sources_deleted_at_idx" ON "agreement_sources"("deleted_at");

-- CreateIndex
CREATE INDEX "agreement_ingest_items_org_ext_idx" ON "agreement_ingest_items"("org_id", "external_source", "external_id");

-- CreateIndex
CREATE INDEX "agreement_ingest_items_org_sha_idx" ON "agreement_ingest_items"("org_id", "sha256");

-- CreateIndex
CREATE INDEX "agreement_ingest_items_status_idx" ON "agreement_ingest_items"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "agreement_ingest_items_org_idem_uq" ON "agreement_ingest_items"("org_id", "actor_type", "actor_id", "idempotency_key");

-- AddForeignKey
ALTER TABLE "agreement_sources" ADD CONSTRAINT "agreement_sources_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreement_ingest_items" ADD CONSTRAINT "agreement_ingest_items_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreement_ingest_items" ADD CONSTRAINT "agreement_ingest_items_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "agreement_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

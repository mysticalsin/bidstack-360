-- Slice 13a review: per-org provider connections for the agreement pull,
-- resumable pull progress, and retry scheduling for source items.

-- CreateTable
CREATE TABLE "agreement_connections" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "provider" VARCHAR(20) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "external_tenant_id" VARCHAR(100),
    "account_id" VARCHAR(100),
    "account_name" VARCHAR(200),
    "base_uri" VARCHAR(300),
    "secret_encrypted" TEXT,
    "state_nonce" VARCHAR(64),
    "created_by_id" UUID NOT NULL,
    "connected_by_id" UUID,
    "connected_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "agreement_connections_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "agreement_sources" ADD COLUMN "connection_id" UUID,
ADD COLUMN "progress" JSONB;

-- AlterTable
ALTER TABLE "agreement_ingest_items" ADD COLUMN "dead_lettered_at" TIMESTAMPTZ(6),
ADD COLUMN "next_attempt_at" TIMESTAMPTZ(6);

-- CreateIndex
CREATE UNIQUE INDEX "agreement_connections_org_provider_uq" ON "agreement_connections"("org_id", "provider");

-- CreateIndex
CREATE INDEX "agreement_ingest_items_source_status_idx" ON "agreement_ingest_items"("source_id", "status");

-- AddForeignKey
ALTER TABLE "agreement_sources" ADD CONSTRAINT "agreement_sources_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "agreement_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreement_connections" ADD CONSTRAINT "agreement_connections_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

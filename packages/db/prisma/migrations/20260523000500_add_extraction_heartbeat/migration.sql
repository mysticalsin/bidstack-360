-- CreateTable
CREATE TABLE IF NOT EXISTS "document_extractions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "account_id" VARCHAR(255) NOT NULL,
    "company_id" UUID,
    "status" VARCHAR(50) NOT NULL DEFAULT 'pending',
    "extracted_data" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,
    "dust_run_id" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "document_extractions_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "document_extractions" ADD CONSTRAINT "document_extractions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_extractions" ADD CONSTRAINT "document_extractions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "doc_extractions_org_account_status_idx" ON "document_extractions"("org_id", "account_id", "status");
CREATE INDEX IF NOT EXISTS "document_extractions_org_id_company_id_idx" ON "document_extractions"("org_id", "company_id");
CREATE INDEX IF NOT EXISTS "document_extractions_deleted_at_idx" ON "document_extractions"("deleted_at");

-- Add heartbeat tracking for document extraction crash recovery
ALTER TABLE "document_extractions" ADD COLUMN IF NOT EXISTS "started_at" TIMESTAMPTZ(6);
ALTER TABLE "document_extractions" ADD COLUMN IF NOT EXISTS "heartbeat_at" TIMESTAMPTZ(6);
CREATE INDEX IF NOT EXISTS "doc_extractions_status_started_idx" ON "document_extractions"("status", "started_at");

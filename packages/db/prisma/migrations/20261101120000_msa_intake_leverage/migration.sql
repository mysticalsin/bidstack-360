-- MSA intake, signing entities, and extra commercial clause fields.

-- AlterTable
ALTER TABLE "contract_agreements" ADD COLUMN     "signing_entity_id" UUID,
ADD COLUMN     "term_months" INTEGER,
ADD COLUMN     "renewal_terms" VARCHAR(500),
ADD COLUMN     "ip_clause" TEXT,
ADD COLUMN     "confidentiality" TEXT,
ADD COLUMN     "non_solicit" TEXT,
ADD COLUMN     "exclusivity" TEXT,
ADD COLUMN     "insurance" TEXT,
ADD COLUMN     "indexation" VARCHAR(500),
ADD COLUMN     "scope_of_services" TEXT,
ADD COLUMN     "affiliates_clause" TEXT,
ADD COLUMN     "parties" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "field_citations" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "signing_entities" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "legal_name" VARCHAR(300),
    "brand_family" VARCHAR(40) NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "business_lines" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "source_url" VARCHAR(500) NOT NULL,
    "verification_status" VARCHAR(20) NOT NULL,
    "notes" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "signing_entities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "msa_intake_drafts" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "status" VARCHAR(24) NOT NULL DEFAULT 'pending_review',
    "file_name" VARCHAR(255) NOT NULL,
    "content_type" VARCHAR(100) NOT NULL,
    "bytes" INTEGER NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "storage_key" VARCHAR(500) NOT NULL,
    "file_attachment_id" UUID,
    "extracted_text" TEXT,
    "page_count" INTEGER,
    "needs_ocr" BOOLEAN NOT NULL DEFAULT false,
    "used_llm" BOOLEAN NOT NULL DEFAULT false,
    "extracted_fields" JSONB NOT NULL DEFAULT '{}',
    "account_matches" JSONB NOT NULL DEFAULT '[]',
    "signing_entity_matches" JSONB NOT NULL DEFAULT '[]',
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "confirmed_contract_id" UUID,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "msa_intake_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "signing_entities_org_slug_uq" ON "signing_entities"("org_id", "slug");

-- CreateIndex
CREATE INDEX "signing_entities_org_family_idx" ON "signing_entities"("org_id", "brand_family");

-- CreateIndex
CREATE INDEX "signing_entities_deleted_at_idx" ON "signing_entities"("deleted_at");

-- CreateIndex
CREATE INDEX "msa_intake_drafts_org_status_idx" ON "msa_intake_drafts"("org_id", "status");

-- CreateIndex
CREATE INDEX "msa_intake_drafts_org_creator_idx" ON "msa_intake_drafts"("org_id", "created_by_id");

-- CreateIndex
CREATE INDEX "msa_intake_drafts_deleted_at_idx" ON "msa_intake_drafts"("deleted_at");

-- CreateIndex
CREATE INDEX "contract_agreements_org_signing_entity_idx" ON "contract_agreements"("org_id", "signing_entity_id");

-- AddForeignKey
ALTER TABLE "signing_entities" ADD CONSTRAINT "signing_entities_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_agreements" ADD CONSTRAINT "contract_agreements_signing_entity_id_fkey" FOREIGN KEY ("signing_entity_id") REFERENCES "signing_entities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "msa_intake_drafts" ADD CONSTRAINT "msa_intake_drafts_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "msa_intake_drafts" ADD CONSTRAINT "msa_intake_drafts_file_attachment_id_fkey" FOREIGN KEY ("file_attachment_id") REFERENCES "file_attachments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "msa_intake_drafts" ADD CONSTRAINT "msa_intake_drafts_confirmed_contract_id_fkey" FOREIGN KEY ("confirmed_contract_id") REFERENCES "contract_agreements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "msa_intake_drafts" ADD CONSTRAINT "msa_intake_drafts_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

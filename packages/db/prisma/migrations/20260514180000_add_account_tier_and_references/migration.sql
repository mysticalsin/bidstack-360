-- Ensure companies table exists (was previously created via db push, not migration)
CREATE TABLE IF NOT EXISTS "companies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "legal_name" TEXT,
    "domain" TEXT,
    "industry" TEXT,
    "employee_count" INTEGER,
    "country_code" VARCHAR(2),
    "address" JSONB DEFAULT '{}',
    "billing_email" CITEXT,
    "tax_id" TEXT,
    "logo_url" TEXT,
    "website" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "enriched_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- Add foreign key if not exists (idempotent for dev DB that already has it)
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'companies_org_id_fkey') THEN
        ALTER TABLE "companies" ADD CONSTRAINT "companies_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- Add unique index if not exists
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'companies_org_id_name_key') THEN
        CREATE UNIQUE INDEX "companies_org_id_name_key" ON "companies"("org_id", "name");
    END IF;
END $$;

-- Add domain index if not exists
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'companies_org_domain_idx') THEN
        CREATE INDEX "companies_org_domain_idx" ON "companies"("org_id", "domain");
    END IF;
END $$;

-- CreateEnum
CREATE TYPE "account_tier" AS ENUM ('key', 'top', 'standard');

-- AlterTable
ALTER TABLE "companies" ADD COLUMN "tier" "account_tier" NOT NULL DEFAULT 'standard';
ALTER TABLE "companies" ADD COLUMN "key_account_since" TIMESTAMPTZ(6);
ALTER TABLE "companies" ADD COLUMN "key_account_owner_id" UUID;
ALTER TABLE "companies" ADD COLUMN "key_account_notes" TEXT;
ALTER TABLE "companies" ADD COLUMN "top_account_rank" INTEGER;

-- CreateTable
CREATE TABLE "references" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "company_id" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "industry" TEXT,
    "value_micros" TEXT,
    "contact_name" TEXT,
    "contact_email" TEXT,
    "usage_count" INTEGER NOT NULL DEFAULT 0,
    "last_used_at" TIMESTAMPTZ(6),
    "document_url" TEXT,
    "tags" TEXT[],
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "references_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "references_org_industry_idx" ON "references"("org_id", "industry");
CREATE INDEX "references_org_company_idx" ON "references"("org_id", "company_id");

-- AddForeignKey
ALTER TABLE "references" ADD CONSTRAINT "references_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "references" ADD CONSTRAINT "references_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

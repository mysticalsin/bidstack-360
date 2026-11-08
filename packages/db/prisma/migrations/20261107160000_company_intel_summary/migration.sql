-- Slice 14 company intel on the Companies list: Apollo organization funding
-- and founded year on company_firmographics, one derived summary row per
-- company (company_intel_summaries) and import enrichment progress
-- (intel_import_batches). Tenant scoped by org_id; cascades with the org and
-- company. No people or contact data is stored.
-- AlterTable
ALTER TABLE "company_firmographics" ADD COLUMN     "founded_year" INTEGER,
ADD COLUMN     "latest_funding_at" TIMESTAMPTZ(6),
ADD COLUMN     "latest_funding_stage" TEXT,
ADD COLUMN     "total_funding_usd" BIGINT;

-- CreateTable
CREATE TABLE "company_intel_summaries" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "revenue_usd_approx" DOUBLE PRECISION,
    "revenue_growth_pct" DOUBLE PRECISION,
    "headcount" INTEGER,
    "headcount_growth_pct" DOUBLE PRECISION,
    "open_roles" INTEGER,
    "new_roles_30d" INTEGER,
    "funding_usd" DOUBLE PRECISION,
    "direction" TEXT,
    "payload" JSONB NOT NULL,
    "sample" BOOLEAN NOT NULL DEFAULT false,
    "computed_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "company_intel_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intel_import_batches" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "migration_job_id" UUID,
    "origin" TEXT NOT NULL,
    "company_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "done_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "failed_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'running',
    "summary" JSONB NOT NULL DEFAULT '{}',
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "intel_import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "company_intel_summaries_company_id_key" ON "company_intel_summaries"("company_id");

-- CreateIndex
CREATE INDEX "company_intel_summaries_org_id_direction_idx" ON "company_intel_summaries"("org_id", "direction");

-- CreateIndex
CREATE INDEX "company_intel_summaries_org_id_revenue_usd_approx_idx" ON "company_intel_summaries"("org_id", "revenue_usd_approx");

-- CreateIndex
CREATE INDEX "company_intel_summaries_org_id_new_roles_30d_idx" ON "company_intel_summaries"("org_id", "new_roles_30d");

-- CreateIndex
CREATE INDEX "intel_import_batches_org_id_created_at_idx" ON "intel_import_batches"("org_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "intel_import_batches_org_id_migration_job_id_key" ON "intel_import_batches"("org_id", "migration_job_id");

-- AddForeignKey
ALTER TABLE "company_intel_summaries" ADD CONSTRAINT "company_intel_summaries_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_intel_summaries" ADD CONSTRAINT "company_intel_summaries_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intel_import_batches" ADD CONSTRAINT "intel_import_batches_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Account enrichment (2026-10-31): firmographics, job postings and the credit ledger.
-- Additive only. See /workspace/fleet/polo-enrichment-api.md.

-- CreateTable
CREATE TABLE "company_firmographics" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "annual_revenue_usd" BIGINT,
    "revenue_range" TEXT,
    "employee_count" INTEGER,
    "employee_range" TEXT,
    "headcount_growth_6m" DOUBLE PRECISION,
    "headcount_growth_12m" DOUBLE PRECISION,
    "headcount_growth_24m" DOUBLE PRECISION,
    "industry" TEXT,
    "industries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "locations" JSONB NOT NULL DEFAULT '[]',
    "tech_stack" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "department_headcount" JSONB,
    "provider_ids" JSONB NOT NULL DEFAULT '{}',
    "provenance" JSONB NOT NULL DEFAULT '{}',
    "provider_status" JSONB NOT NULL DEFAULT '{}',
    "hiring" JSONB,
    "projects" JSONB NOT NULL DEFAULT '[]',
    "fetched_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),
    "requested_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "company_firmographics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_job_postings" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT,
    "region" TEXT NOT NULL,
    "function" TEXT NOT NULL,
    "seniority" TEXT NOT NULL,
    "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "posted_at" TIMESTAMPTZ(6),
    "last_seen_at" TIMESTAMPTZ(6),
    "fetched_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "company_job_postings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrichment_credit_usage" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "credits" INTEGER NOT NULL,
    "company_id" UUID,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enrichment_credit_usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "company_firmographics_company_id_key" ON "company_firmographics"("company_id");

-- CreateIndex
CREATE INDEX "company_firmographics_org_id_expires_at_idx" ON "company_firmographics"("org_id", "expires_at");

-- CreateIndex
CREATE INDEX "company_job_postings_org_id_company_id_function_idx" ON "company_job_postings"("org_id", "company_id", "function");

-- CreateIndex
CREATE UNIQUE INDEX "company_job_postings_org_id_company_id_source_external_id_key" ON "company_job_postings"("org_id", "company_id", "source", "external_id");

-- CreateIndex
CREATE INDEX "enrichment_credit_usage_org_id_provider_at_idx" ON "enrichment_credit_usage"("org_id", "provider", "at");

-- AddForeignKey
ALTER TABLE "company_firmographics" ADD CONSTRAINT "company_firmographics_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_firmographics" ADD CONSTRAINT "company_firmographics_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_job_postings" ADD CONSTRAINT "company_job_postings_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_job_postings" ADD CONSTRAINT "company_job_postings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrichment_credit_usage" ADD CONSTRAINT "enrichment_credit_usage_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

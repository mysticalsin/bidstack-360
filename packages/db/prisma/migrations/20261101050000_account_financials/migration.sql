-- v23: financial statements and early-warning layer, tier-gated.
-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "track_financials" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "account_financial_profiles" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "source" TEXT,
    "entity_id" TEXT,
    "entity_name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "last_error" TEXT,
    "last_pulled_at" TIMESTAMPTZ(6),
    "next_pull_at" TIMESTAMPTZ(6),
    "signals" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "account_financial_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_financial_periods" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "period_type" TEXT NOT NULL,
    "fiscal_year" INTEGER NOT NULL,
    "period_start" DATE,
    "period_end" DATE NOT NULL,
    "currency" TEXT NOT NULL,
    "source_url" TEXT NOT NULL,
    "filed_at" TIMESTAMPTZ(6),
    "metrics" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "account_financial_periods_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "account_financial_profiles_org_id_next_pull_at_idx" ON "account_financial_profiles"("org_id", "next_pull_at");

-- CreateIndex
CREATE UNIQUE INDEX "account_financial_profiles_company_id_key" ON "account_financial_profiles"("company_id");

-- CreateIndex
CREATE INDEX "account_financial_periods_org_id_company_id_period_end_idx" ON "account_financial_periods"("org_id", "company_id", "period_end");

-- CreateIndex
CREATE UNIQUE INDEX "account_financial_periods_company_id_source_period_type_per_key" ON "account_financial_periods"("company_id", "source", "period_type", "period_end");

-- AddForeignKey
ALTER TABLE "account_financial_profiles" ADD CONSTRAINT "account_financial_profiles_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_financial_profiles" ADD CONSTRAINT "account_financial_profiles_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_financial_periods" ADD CONSTRAINT "account_financial_periods_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_financial_periods" ADD CONSTRAINT "account_financial_periods_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

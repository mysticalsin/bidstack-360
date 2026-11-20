-- Slice 15 consulting partners: one row per firm read out of one public item
-- or one internal record for an account, plus the last scan per account.
-- Tenant scoped by org_id; cascades with the org and the company.
-- Internal rows store record type and id only (plus the opportunity id) so
-- reads re-check the caller's access to the record. Retention: rows older
-- than 3 years by fetched_at are pruned by the consulting-partners worker.

-- CreateTable
CREATE TABLE "consulting_partner_evidence" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "firm_key" VARCHAR(64) NOT NULL,
    "firm_name" VARCHAR(120) NOT NULL,
    "origin" VARCHAR(16) NOT NULL,
    "source" VARCHAR(32) NOT NULL,
    "method" VARCHAR(32) NOT NULL,
    "inferred" BOOLEAN NOT NULL DEFAULT false,
    "key" VARCHAR(200) NOT NULL,
    "url" TEXT,
    "record_type" VARCHAR(32),
    "record_id" UUID,
    "opportunity_id" UUID,
    "title" TEXT,
    "excerpt" TEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ(6),
    "fetched_at" TIMESTAMPTZ(6) NOT NULL,
    "relationship" VARCHAR(32),
    "domains" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "context" VARCHAR(32),
    "sentiment" VARCHAR(16),
    "remarks" JSONB NOT NULL DEFAULT '[]',
    "outcome" VARCHAR(8),
    "sample" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

CONSTRAINT "consulting_partner_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consulting_partner_runs" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "last_fetched_at" TIMESTAMPTZ(6),
    "result" JSONB NOT NULL DEFAULT '{}',
    "detail" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

CONSTRAINT "consulting_partner_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "consulting_partner_evidence_org_id_company_id_firm_key_occu_idx" ON "consulting_partner_evidence"("org_id", "company_id", "firm_key", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "consulting_partner_evidence_org_id_fetched_at_idx" ON "consulting_partner_evidence"("org_id", "fetched_at");

-- CreateIndex
CREATE UNIQUE INDEX "consulting_partner_evidence_org_id_company_id_firm_key_key_key" ON "consulting_partner_evidence"("org_id", "company_id", "firm_key", "key");

-- CreateIndex
CREATE UNIQUE INDEX "consulting_partner_runs_org_id_company_id_key" ON "consulting_partner_runs"("org_id", "company_id");

-- AddForeignKey
ALTER TABLE "consulting_partner_evidence" ADD CONSTRAINT "consulting_partner_evidence_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consulting_partner_evidence" ADD CONSTRAINT "consulting_partner_evidence_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consulting_partner_runs" ADD CONSTRAINT "consulting_partner_runs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consulting_partner_runs" ADD CONSTRAINT "consulting_partner_runs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

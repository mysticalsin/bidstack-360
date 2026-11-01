-- CreateEnum
CREATE TYPE "contact_fact_kind" AS ENUM ('reports_to', 'buying_role', 'company_link');

-- CreateEnum
CREATE TYPE "contact_fact_status" AS ENUM ('proposed', 'accepted', 'dismissed', 'needs_review');

-- CreateEnum
CREATE TYPE "customer_commitment_status" AS ENUM ('open', 'met', 'missed', 'needs_review');

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "reports_to_contact_id" UUID;

-- CreateTable
CREATE TABLE "contact_facts" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "kind" "contact_fact_kind" NOT NULL,
    "status" "contact_fact_status" NOT NULL DEFAULT 'proposed',
    "claim" TEXT NOT NULL,
    "reports_to_contact_id" UUID,
    "opportunity_id" UUID,
    "company_id" UUID,
    "link_label" VARCHAR(80),
    "evidence_detail" TEXT,
    "observed_at" TIMESTAMPTZ(6),
    "decided_by_user_id" UUID,
    "decided_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "contact_facts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_commitments" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "opportunity_id" UUID,
    "promise" TEXT NOT NULL,
    "due_date" DATE,
    "owner_contact_id" UUID,
    "status" "customer_commitment_status" NOT NULL DEFAULT 'open',
    "source_note" TEXT,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "customer_commitments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contact_facts_org_contact_status_idx" ON "contact_facts"("org_id", "contact_id", "status");

-- CreateIndex
CREATE INDEX "contact_facts_reports_to_contact_id_idx" ON "contact_facts"("reports_to_contact_id");

-- CreateIndex
CREATE INDEX "contact_facts_opportunity_id_idx" ON "contact_facts"("opportunity_id");

-- CreateIndex
CREATE INDEX "contact_facts_company_id_idx" ON "contact_facts"("company_id");

-- CreateIndex
CREATE INDEX "contact_facts_deleted_at_idx" ON "contact_facts"("deleted_at");

-- CreateIndex
CREATE INDEX "customer_commitments_org_company_status_idx" ON "customer_commitments"("org_id", "company_id", "status");

-- CreateIndex
CREATE INDEX "customer_commitments_org_opp_idx" ON "customer_commitments"("org_id", "opportunity_id");

-- CreateIndex
CREATE INDEX "customer_commitments_owner_contact_id_idx" ON "customer_commitments"("owner_contact_id");

-- CreateIndex
CREATE INDEX "customer_commitments_deleted_at_idx" ON "customer_commitments"("deleted_at");

-- CreateIndex
CREATE INDEX "contacts_reports_to_contact_id_idx" ON "contacts"("reports_to_contact_id");

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_reports_to_contact_id_fkey" FOREIGN KEY ("reports_to_contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_facts" ADD CONSTRAINT "contact_facts_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_facts" ADD CONSTRAINT "contact_facts_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_facts" ADD CONSTRAINT "contact_facts_reports_to_contact_id_fkey" FOREIGN KEY ("reports_to_contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_facts" ADD CONSTRAINT "contact_facts_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_facts" ADD CONSTRAINT "contact_facts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_commitments" ADD CONSTRAINT "customer_commitments_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_commitments" ADD CONSTRAINT "customer_commitments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_commitments" ADD CONSTRAINT "customer_commitments_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_commitments" ADD CONSTRAINT "customer_commitments_owner_contact_id_fkey" FOREIGN KEY ("owner_contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;


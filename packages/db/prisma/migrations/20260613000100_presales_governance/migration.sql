-- CreateEnum
CREATE TYPE "governance_status" AS ENUM ('open', 'in_progress', 'done');

-- CreateEnum
CREATE TYPE "governance_meeting_type" AS ENUM ('monthly_committee', 'quarterly_c_level', 'brm', 'sar_review', 'other');

-- CreateEnum
CREATE TYPE "project_reference_status" AS ENUM ('draft', 'manager_review', 'validated', 'dispatched');

-- AlterTable
ALTER TABLE "org_settings" ADD COLUMN     "opportunity_filter_rules" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "cross_sell_actions" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "account_key" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "requesting_unit" TEXT NOT NULL,
    "assigned_unit" TEXT NOT NULL,
    "assignee_id" UUID,
    "due_date" TIMESTAMPTZ(6),
    "status" "governance_status" NOT NULL DEFAULT 'open',
    "notes" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "cross_sell_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "governance_meetings" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "account_key" TEXT NOT NULL,
    "meeting_type" "governance_meeting_type" NOT NULL,
    "date" TIMESTAMPTZ(6) NOT NULL,
    "participants" TEXT[],
    "outcomes" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "governance_meetings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "governance_actions" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "meeting_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "owner_id" UUID,
    "due_date" TIMESTAMPTZ(6),
    "status" "governance_status" NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "governance_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_references" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "account_key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "technical_summary" TEXT,
    "business_summary" TEXT,
    "status" "project_reference_status" NOT NULL DEFAULT 'manager_review',
    "source_system" TEXT NOT NULL DEFAULT 'spotlight_ref',
    "validated_by_id" UUID,
    "dispatched_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "project_references_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cross_sell_actions_org_account_idx" ON "cross_sell_actions"("org_id", "account_key");

-- CreateIndex
CREATE INDEX "cross_sell_actions_org_status_idx" ON "cross_sell_actions"("org_id", "status");

-- CreateIndex
CREATE INDEX "cross_sell_actions_deleted_at_idx" ON "cross_sell_actions"("deleted_at");

-- CreateIndex
CREATE INDEX "governance_meetings_org_account_date_idx" ON "governance_meetings"("org_id", "account_key", "date" DESC);

-- CreateIndex
CREATE INDEX "governance_meetings_deleted_at_idx" ON "governance_meetings"("deleted_at");

-- CreateIndex
CREATE INDEX "governance_actions_org_meeting_idx" ON "governance_actions"("org_id", "meeting_id");

-- CreateIndex
CREATE INDEX "project_references_org_account_idx" ON "project_references"("org_id", "account_key");

-- CreateIndex
CREATE INDEX "project_references_deleted_at_idx" ON "project_references"("deleted_at");

-- AddForeignKey
ALTER TABLE "cross_sell_actions" ADD CONSTRAINT "cross_sell_actions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cross_sell_actions" ADD CONSTRAINT "cross_sell_actions_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "governance_meetings" ADD CONSTRAINT "governance_meetings_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "governance_actions" ADD CONSTRAINT "governance_actions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "governance_actions" ADD CONSTRAINT "governance_actions_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "governance_meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "governance_actions" ADD CONSTRAINT "governance_actions_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_references" ADD CONSTRAINT "project_references_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;


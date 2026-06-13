-- CreateEnum
CREATE TYPE "win_loss_outcome" AS ENUM ('won', 'lost');

-- CreateEnum
CREATE TYPE "win_loss_reason_code" AS ENUM ('price', 'product_fit', 'timing', 'competitor', 'relationship', 'scope', 'no_decision', 'other');

-- CreateTable
CREATE TABLE "win_loss_records" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "opportunity_id" UUID NOT NULL,
    "outcome" "win_loss_outcome" NOT NULL,
    "reason" "win_loss_reason_code" NOT NULL,
    "competitor" TEXT,
    "note" TEXT,
    "recorded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "win_loss_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "win_loss_records_opportunity_id_key" ON "win_loss_records"("opportunity_id");

-- CreateIndex
CREATE INDEX "win_loss_records_org_outcome_reason_idx" ON "win_loss_records"("org_id", "outcome", "reason");

-- CreateIndex
CREATE INDEX "win_loss_records_org_opp_idx" ON "win_loss_records"("org_id", "opportunity_id");

-- AddForeignKey
ALTER TABLE "win_loss_records" ADD CONSTRAINT "win_loss_records_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "win_loss_records" ADD CONSTRAINT "win_loss_records_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Amaris Bid Office Americas — persist the C0–C4 classification on the
-- opportunity and add formal governance gate sign-off records. Additive only
-- (nullable columns + a new table); safe on a live DB and backward-compatible
-- with the running API.

-- AlterTable
ALTER TABLE "opportunities" ADD COLUMN     "bid_class" TEXT,
ADD COLUMN     "commitment_level" TEXT,
ADD COLUMN     "fte_estimate" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "gate_decisions" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "opportunity_id" UUID NOT NULL,
    "gate" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "bid_class" TEXT,
    "decided_by_id" UUID,
    "decided_by_role" TEXT,
    "justification" TEXT,
    "decided_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gate_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "gate_decisions_org_id_opportunity_id_idx" ON "gate_decisions"("org_id", "opportunity_id");

-- CreateIndex
CREATE INDEX "gate_decisions_org_id_opportunity_id_gate_idx" ON "gate_decisions"("org_id", "opportunity_id", "gate");

-- AddForeignKey
ALTER TABLE "gate_decisions" ADD CONSTRAINT "gate_decisions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gate_decisions" ADD CONSTRAINT "gate_decisions_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

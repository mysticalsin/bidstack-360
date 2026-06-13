-- AlterTable
ALTER TABLE "bid_scores" ADD COLUMN     "overridden_by" UUID,
ADD COLUMN     "override_justification" TEXT;


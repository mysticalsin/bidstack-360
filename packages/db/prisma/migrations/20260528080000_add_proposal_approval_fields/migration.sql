-- AlterTable
ALTER TABLE "proposals" ADD COLUMN "approved_at" TIMESTAMPTZ(6);
ALTER TABLE "proposals" ADD COLUMN "approved_by_user_id" UUID;
ALTER TABLE "proposals" ADD COLUMN "human_review_required" BOOLEAN NOT NULL DEFAULT true;

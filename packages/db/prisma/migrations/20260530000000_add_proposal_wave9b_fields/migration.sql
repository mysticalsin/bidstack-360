-- Wave 9b proposal compilation + QA review fields (+ the approval-gate fields).
-- These were added to schema.prisma without a corresponding migration, so the
-- columns were missing from the database and GET /api/proposals 500'd with
-- Prisma P2022: column "proposals.compiled_content" does not exist. That broke
-- the entire Proposals feature (the /proposals page and the RFP hub card).
-- IF NOT EXISTS keeps this safe to apply where some columns already landed.
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "approved_at" TIMESTAMPTZ(6);
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "approved_by_user_id" UUID;
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "human_review_required" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "compiled_content" TEXT;
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "compiled_at" TIMESTAMPTZ(6);
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "qa_score_bps" INTEGER;
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "qa_reviewed_at" TIMESTAMPTZ(6);
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "qa_issues" JSONB;

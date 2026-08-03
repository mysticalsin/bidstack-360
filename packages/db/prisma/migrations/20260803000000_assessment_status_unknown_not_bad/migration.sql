-- Fusion Phase 6: "unknown stops meaning bad".
-- A fallback that could not run an AI assessment must no longer write a fake
-- 0 score / PARTIAL verdict; it records UNAVAILABLE with a NULL score instead.
-- Additive-only: no column is dropped or renamed; backfills run in this same
-- migration so no existing row is ever read with the new columns unset.

-- CreateEnum
CREATE TYPE "assessment_status" AS ENUM ('ASSESSED', 'UNAVAILABLE', 'PENDING');

-- requirements.confidence_bps: 0 stops being the "no assessment" sentinel.
-- Manual requirements and unavailable assessments store NULL from now on.
ALTER TABLE "requirements" ALTER COLUMN "confidence_bps" DROP NOT NULL;
ALTER TABLE "requirements" ALTER COLUMN "confidence_bps" DROP DEFAULT;
ALTER TABLE "requirements" ADD COLUMN "assessment_status" "assessment_status" NOT NULL DEFAULT 'PENDING';

-- compliance_matrix_rows: the fill worker's confidence was previously
-- discarded entirely; persist it alongside the assessment status the UI
-- renders. confidence_bps stays NULL for all historical rows — that data
-- never existed and is not invented here.
ALTER TABLE "compliance_matrix_rows" ADD COLUMN "confidence_bps" INTEGER;
ALTER TABLE "compliance_matrix_rows" ADD COLUMN "assessment_status" "assessment_status" NOT NULL DEFAULT 'PENDING';

-- proposals.qa_score_bps is already nullable; add the paired status so a
-- NULL score is distinguishable as "QA never ran" vs "QA was unavailable".
ALTER TABLE "proposals" ADD COLUMN "qa_assessment_status" "assessment_status" NOT NULL DEFAULT 'PENDING';

-- Backfill BEFORE any writer emits NULL (same migration, per fusion plan).
-- Requirements: every existing row carries a confidence the UI already
-- rendered as real, so all are marked ASSESSED.
UPDATE "requirements" SET "assessment_status" = 'ASSESSED';

-- Compliance rows: only rows the fill worker (or a human) actually touched
-- are ASSESSED; untouched rows ('not_started') stay PENDING — marking them
-- ASSESSED would invent an assessment that never happened.
UPDATE "compliance_matrix_rows" SET "assessment_status" = 'ASSESSED'
WHERE "response_status" <> 'not_started';

-- Proposals: QA ran iff qa_reviewed_at is set.
UPDATE "proposals" SET "qa_assessment_status" = 'ASSESSED'
WHERE "qa_reviewed_at" IS NOT NULL;

-- RFP Pipeline Completion — Proposal compilation, QA review, and phase enum expansion
-- Idempotent: all ALTER statements use IF NOT EXISTS / IF NOT EXISTS equivalent

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. Proposal compilation fields
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE proposals
  ADD COLUMN IF NOT EXISTS compiled_content TEXT,
  ADD COLUMN IF NOT EXISTS compiled_at TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS qa_score_bps INTEGER,
  ADD COLUMN IF NOT EXISTS qa_reviewed_at TIMESTAMPTZ(6),
  -- No DEFAULT: schema.prisma declares `qaIssues Json?` (nullable, no default).
  -- Keeping them aligned so `prisma migrate diff` reports zero drift.
  ADD COLUMN IF NOT EXISTS qa_issues JSONB;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. RfpResponsePhase enum expansion
-- PostgreSQL: ALTER TYPE ... ADD VALUE is transactional but only works for
-- enums that are NOT part of a composite type or array. It appends to the
-- enum's internal sort order. These are safe because they are new values.
-- ═══════════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  ALTER TYPE "RfpResponsePhase" ADD VALUE IF NOT EXISTS 'legal_scan';
  ALTER TYPE "RfpResponsePhase" ADD VALUE IF NOT EXISTS 'proposal_compile';
  ALTER TYPE "RfpResponsePhase" ADD VALUE IF NOT EXISTS 'qa_review';
  ALTER TYPE "RfpResponsePhase" ADD VALUE IF NOT EXISTS 'awaiting_approval';
EXCEPTION
  WHEN duplicate_object THEN
    NULL; -- value already exists, safe to ignore
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. RfpOrchestrationState enum expansion
-- ═══════════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  ALTER TYPE "RfpOrchestrationState" ADD VALUE IF NOT EXISTS 'awaiting_approval';
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;


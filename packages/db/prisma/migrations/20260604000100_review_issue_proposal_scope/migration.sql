-- RFP-REVIEW-001 / RFP-GATE-001 — scope review-crew findings to a proposal/run.
-- Without this, a re-run of the same opportunity soft-deleted a sibling run's
-- still-open high/critical findings (opportunity-wide retirement), letting a bid
-- pass the human approval gate with untriaged blockers. Findings are now scoped
-- by proposal_id; the approval gate reads exactly this proposal's blockers.

ALTER TABLE "review_issues" ADD COLUMN IF NOT EXISTS "proposal_id" UUID;

DO $$ BEGIN
  ALTER TABLE "review_issues"
    ADD CONSTRAINT "review_issues_proposal_fk"
    FOREIGN KEY ("proposal_id") REFERENCES "proposals"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS "review_issues_org_proposal_idx"
  ON "review_issues"("org_id", "proposal_id", "severity", "status");

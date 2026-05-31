-- Adds the human-review flag to proposal sections (RFP draft-review pane). Lets a
-- reviewer mark which AI-drafted sections they've signed off on at the approval
-- stage. Matches ProposalSection.humanReviewed in schema.prisma (no drift).
ALTER TABLE "proposal_sections"
  ADD COLUMN IF NOT EXISTS "human_reviewed" BOOLEAN NOT NULL DEFAULT false;

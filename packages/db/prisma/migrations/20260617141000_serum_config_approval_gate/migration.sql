-- Add high-risk SERUM config approval state.
ALTER TABLE "serum_config_versions"
  ADD COLUMN "approval_status" VARCHAR(30) NOT NULL DEFAULT 'not_required',
  ADD COLUMN "approval_requested_at" TIMESTAMPTZ(6),
  ADD COLUMN "approval_requested_by_user_id" UUID,
  ADD COLUMN "approval_approved_at" TIMESTAMPTZ(6),
  ADD COLUMN "approval_reference" VARCHAR(120);

CREATE INDEX "serum_config_versions_org_approval_status_idx"
  ON "serum_config_versions"("org_id", "approval_status");

-- Org chart nodes: contact details, imported profile and the import reference.
ALTER TABLE "org_chart_nodes"
  ADD COLUMN "email" VARCHAR(254),
  ADD COLUMN "phone" VARCHAR(32),
  ADD COLUMN "linkedin_url" VARCHAR(300),
  ADD COLUMN "profile" JSONB,
  ADD COLUMN "import_ref" VARCHAR(200);

CREATE INDEX "org_chart_nodes_chart_id_import_ref_idx" ON "org_chart_nodes"("chart_id", "import_ref");

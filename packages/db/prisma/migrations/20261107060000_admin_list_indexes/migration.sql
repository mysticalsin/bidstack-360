-- Admin review: back the service desk and workflow list sort orders.
CREATE INDEX "service_cases_org_created_idx" ON "service_cases"("org_id", "created_at" DESC, "id" DESC);

CREATE INDEX "workflows_org_updated_idx" ON "workflows"("org_id", "updated_at" DESC);

-- BidStack 360° — Schema migration generated from Prisma diff
-- Adds missing FK indexes, soft-delete columns, and removes conflicting unique constraints.

-- ─── Remove conflicting unique constraints (will be replaced by partial unique indexes below) ───
DROP INDEX "companies_org_domain_key";
DROP INDEX "companies_org_id_name_key";

-- ─── Add deletedAt to models missing soft-delete ───
ALTER TABLE "ai_assistant_feedback" ADD COLUMN "deleted_at" TIMESTAMPTZ(6);
ALTER TABLE "call_summaries" ADD COLUMN "deleted_at" TIMESTAMPTZ(6);
ALTER TABLE "custom_object_defs" ADD COLUMN "deleted_at" TIMESTAMPTZ(6);
ALTER TABLE "custom_object_relations" ADD COLUMN "deleted_at" TIMESTAMPTZ(6);
ALTER TABLE "email_tracking_pixels" ADD COLUMN "deleted_at" TIMESTAMPTZ(6);
ALTER TABLE "graph_subscriptions" ADD COLUMN "deleted_at" TIMESTAMPTZ(6);
ALTER TABLE "slack_channels" ADD COLUMN "deleted_at" TIMESTAMPTZ(6);
ALTER TABLE "slack_user_mappings" ADD COLUMN "deleted_at" TIMESTAMPTZ(6);
ALTER TABLE "yjs_documents" ADD COLUMN "deleted_at" TIMESTAMPTZ(6);
ALTER TABLE "yjs_updates" ADD COLUMN "deleted_at" TIMESTAMPTZ(6);
ALTER TABLE "zapier_actions" ADD COLUMN "deleted_at" TIMESTAMPTZ(6);
ALTER TABLE "zapier_apps" ADD COLUMN "deleted_at" TIMESTAMPTZ(6);
ALTER TABLE "zapier_subscriptions" ADD COLUMN "deleted_at" TIMESTAMPTZ(6);
ALTER TABLE "zapier_triggers" ADD COLUMN "deleted_at" TIMESTAMPTZ(6);

-- ─── Add missing FK indexes ───
CREATE INDEX "approval_gates_locked_version_id_idx" ON "approval_gates"("locked_version_id");
CREATE INDEX "churn_signals_account_id_idx" ON "churn_signals"("account_id");
CREATE INDEX "expansion_opportunities_account_id_idx" ON "expansion_opportunities"("account_id");
CREATE INDEX "health_scores_account_id_idx" ON "health_scores"("account_id");
CREATE INDEX "invoices_customer_id_idx" ON "invoices"("customer_id");
CREATE INDEX "leads_converted_to_opportunity_id_idx" ON "leads"("converted_to_opportunity_id");
CREATE INDEX "nps_surveys_contact_id_idx" ON "nps_surveys"("contact_id");
CREATE INDEX "opportunities_company_id_idx" ON "opportunities"("company_id");
CREATE INDEX "opportunities_territory_id_idx" ON "opportunities"("territory_id");
CREATE INDEX "renewal_opportunities_opportunity_id_idx" ON "renewal_opportunities"("opportunity_id");
CREATE INDEX "requirements_document_version_id_idx" ON "requirements"("document_version_id");
CREATE INDEX "requirements_source_chunk_id_idx" ON "requirements"("source_chunk_id");
CREATE INDEX "review_issues_requirement_id_idx" ON "review_issues"("requirement_id");
CREATE INDEX "review_issues_source_chunk_id_idx" ON "review_issues"("source_chunk_id");
CREATE INDEX "sales_orders_customer_id_idx" ON "sales_orders"("customer_id");
CREATE INDEX "subscriptions_product_id_idx" ON "subscriptions"("product_id");

-- ─── Add deletedAt indexes for newly soft-deleted models ───
CREATE INDEX "ai_assistant_feedback_deleted_at_idx" ON "ai_assistant_feedback"("deleted_at");
CREATE INDEX "call_summaries_deleted_at_idx" ON "call_summaries"("deleted_at");
CREATE INDEX "custom_object_defs_deleted_at_idx" ON "custom_object_defs"("deleted_at");
CREATE INDEX "custom_object_relations_deleted_at_idx" ON "custom_object_relations"("deleted_at");
CREATE INDEX "email_tracking_pixels_deleted_at_idx" ON "email_tracking_pixels"("deleted_at");
CREATE INDEX "graph_subscriptions_deleted_at_idx" ON "graph_subscriptions"("deleted_at");
CREATE INDEX "slack_channels_deleted_at_idx" ON "slack_channels"("deleted_at");
CREATE INDEX "slack_user_mappings_deleted_at_idx" ON "slack_user_mappings"("deleted_at");
CREATE INDEX "yjs_documents_deleted_at_idx" ON "yjs_documents"("deleted_at");
CREATE INDEX "yjs_updates_deleted_at_idx" ON "yjs_updates"("deleted_at");
CREATE INDEX "zapier_actions_deleted_at_idx" ON "zapier_actions"("deleted_at");
CREATE INDEX "zapier_apps_deleted_at_idx" ON "zapier_apps"("deleted_at");
CREATE INDEX "zapier_subscriptions_deleted_at_idx" ON "zapier_subscriptions"("deleted_at");
CREATE INDEX "zapier_triggers_deleted_at_idx" ON "zapier_triggers"("deleted_at");

-- ─── Deduplicate contacts before adding partial unique index ───
-- Multiple contacts share the same email because no unique constraint existed.
-- We preserve every row but NULL out the duplicate emails (keeping the oldest
-- row per org+email) so the partial unique index can be created safely.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (PARTITION BY org_id, email ORDER BY created_at, id) AS rn
  FROM contacts
  WHERE email IS NOT NULL
)
UPDATE contacts
SET email = NULL
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- ─── Partial unique indexes for soft-delete collision prevention ───
-- Prisma 5 does not support partial unique indexes natively, so we express them
-- as raw SQL. These enforce uniqueness only among non-deleted rows.
CREATE UNIQUE INDEX "companies_org_id_name_unique" ON "companies"("org_id", "name") WHERE "deleted_at" IS NULL;
CREATE UNIQUE INDEX "companies_org_id_domain_unique" ON "companies"("org_id", "domain") WHERE "deleted_at" IS NULL;
CREATE UNIQUE INDEX "contacts_org_id_email_unique" ON "contacts"("org_id", "email") WHERE "deleted_at" IS NULL;
CREATE UNIQUE INDEX "leads_org_id_email_unique" ON "leads"("org_id", "email") WHERE "deleted_at" IS NULL;

-- ─── Check constraints for bounded integer columns ───
ALTER TABLE "leads" ADD CONSTRAINT "leads_score_check" CHECK ("score" >= 0 AND "score" <= 100);
ALTER TABLE "nps_surveys" ADD CONSTRAINT "nps_surveys_score11_check" CHECK ("score_11" >= 0 AND "score_11" <= 10);

-- DropForeignKey
ALTER TABLE "hermes_sessions" DROP CONSTRAINT "hermes_sessions_org_id_fkey";

-- DropForeignKey
ALTER TABLE "hermes_sessions" DROP CONSTRAINT "hermes_sessions_user_id_fkey";

-- DropForeignKey
ALTER TABLE "hermes_tool_calls" DROP CONSTRAINT "hermes_tool_calls_org_id_fkey";

-- DropForeignKey
ALTER TABLE "hermes_tool_calls" DROP CONSTRAINT "hermes_tool_calls_session_id_fkey";

-- DropForeignKey
ALTER TABLE "rfp_agent_runs" DROP CONSTRAINT "rfp_agent_runs_org_id_fkey";

-- DropForeignKey
ALTER TABLE "rfp_agent_runs" DROP CONSTRAINT "rfp_agent_runs_rfp_id_fkey";

-- DropForeignKey
ALTER TABLE "rfp_rate_cards" DROP CONSTRAINT "rfp_rate_cards_org_id_fkey";

-- DropForeignKey
ALTER TABLE "rfp_responses" DROP CONSTRAINT "rfp_responses_org_id_fkey";

-- DropForeignKey
ALTER TABLE "rfp_responses" DROP CONSTRAINT "rfp_responses_rfp_id_fkey";

-- DropForeignKey
ALTER TABLE "rfp_sections" DROP CONSTRAINT "rfp_sections_org_id_fkey";

-- DropForeignKey
ALTER TABLE "rfp_sections" DROP CONSTRAINT "rfp_sections_rfp_id_fkey";

-- DropForeignKey
ALTER TABLE "rfp_templates" DROP CONSTRAINT "rfp_templates_org_id_fkey";

-- DropForeignKey
ALTER TABLE "rfps" DROP CONSTRAINT "rfps_document_id_fkey";

-- DropForeignKey
ALTER TABLE "rfps" DROP CONSTRAINT "rfps_org_id_fkey";

-- AlterTable
ALTER TABLE "agent_runs" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "agents" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "integration_configs" ALTER COLUMN "id" DROP DEFAULT;

-- DropTable
DROP TABLE "hermes_sessions";

-- DropTable
DROP TABLE "hermes_tool_calls";

-- DropTable
DROP TABLE "rfp_agent_runs";

-- DropTable
DROP TABLE "rfp_rate_cards";

-- DropTable
DROP TABLE "rfp_responses";

-- DropTable
DROP TABLE "rfp_sections";

-- DropTable
DROP TABLE "rfp_templates";

-- DropTable
DROP TABLE "rfps";

-- DropEnum
DROP TYPE "hermes_session_status";

-- DropEnum
DROP TYPE "rfp_status";

-- DropEnum
DROP TYPE "rfp_verdict";

-- CreateTable
CREATE TABLE "memos_traces" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "tier" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "memos_traces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memos_policies" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "scope_type" TEXT NOT NULL,
    "scope_id" UUID,
    "insight" TEXT NOT NULL,
    "confidence" INTEGER NOT NULL DEFAULT 5000,
    "evidence" JSONB NOT NULL,
    "source_traces" UUID[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "memos_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memos_world_models" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "domain" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "trend" TEXT,
    "relevance" INTEGER NOT NULL DEFAULT 5000,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "memos_world_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bid_scores" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "opportunity_id" UUID NOT NULL,
    "scored_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "criteria" JSONB NOT NULL,
    "total_score" INTEGER NOT NULL,
    "category_scores" JSONB NOT NULL,
    "weighted_sum" DOUBLE PRECISION NOT NULL,
    "total_weight" DOUBLE PRECISION NOT NULL,
    "ai_suggested" BOOLEAN NOT NULL DEFAULT false,
    "memos_policies" UUID[],
    "recommendation" TEXT NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "bid_scores_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "memos_traces_org_id_module_entity_type_entity_id_idx" ON "memos_traces"("org_id", "module", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "memos_traces_org_id_tier_created_at_idx" ON "memos_traces"("org_id", "tier", "created_at");

-- CreateIndex
CREATE INDEX "memos_traces_org_id_user_id_created_at_idx" ON "memos_traces"("org_id", "user_id", "created_at");

-- CreateIndex
CREATE INDEX "memos_traces_deleted_at_idx" ON "memos_traces"("deleted_at");

-- CreateIndex
CREATE INDEX "memos_policies_org_id_category_active_idx" ON "memos_policies"("org_id", "category", "active");

-- CreateIndex
CREATE INDEX "memos_policies_org_id_scope_type_scope_id_idx" ON "memos_policies"("org_id", "scope_type", "scope_id");

-- CreateIndex
CREATE INDEX "memos_policies_org_id_key_idx" ON "memos_policies"("org_id", "key");

-- CreateIndex
CREATE INDEX "memos_policies_deleted_at_idx" ON "memos_policies"("deleted_at");

-- CreateIndex
CREATE INDEX "memos_world_models_org_id_domain_key_idx" ON "memos_world_models"("org_id", "domain", "key");

-- CreateIndex
CREATE INDEX "memos_world_models_org_id_expires_at_idx" ON "memos_world_models"("org_id", "expires_at");

-- CreateIndex
CREATE INDEX "memos_world_models_deleted_at_idx" ON "memos_world_models"("deleted_at");

-- CreateIndex
CREATE INDEX "bid_scores_org_id_opportunity_id_idx" ON "bid_scores"("org_id", "opportunity_id");

-- CreateIndex
CREATE INDEX "bid_scores_org_id_scored_by_idx" ON "bid_scores"("org_id", "scored_by");

-- CreateIndex
CREATE INDEX "bid_scores_org_id_recommendation_idx" ON "bid_scores"("org_id", "recommendation");

-- CreateIndex
CREATE INDEX "bid_scores_deleted_at_idx" ON "bid_scores"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "bid_scores_org_id_opportunity_id_version_key" ON "bid_scores"("org_id", "opportunity_id", "version");

-- AddForeignKey
ALTER TABLE "memos_traces" ADD CONSTRAINT "memos_traces_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memos_policies" ADD CONSTRAINT "memos_policies_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memos_world_models" ADD CONSTRAINT "memos_world_models_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_scores" ADD CONSTRAINT "bid_scores_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_scores" ADD CONSTRAINT "bid_scores_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


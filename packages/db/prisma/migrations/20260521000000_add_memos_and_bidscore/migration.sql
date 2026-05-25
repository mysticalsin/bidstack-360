-- MemOS tables
CREATE TABLE IF NOT EXISTS "memos_traces" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
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
CREATE INDEX IF NOT EXISTS "memos_traces_org_module_entity_type_entity_id_idx" ON "memos_traces"("org_id", "module", "entity_type", "entity_id");
CREATE INDEX IF NOT EXISTS "memos_traces_org_tier_created_at_idx" ON "memos_traces"("org_id", "tier", "created_at");
CREATE INDEX IF NOT EXISTS "memos_traces_org_user_id_created_at_idx" ON "memos_traces"("org_id", "user_id", "created_at");
CREATE INDEX IF NOT EXISTS "memos_traces_deleted_at_idx" ON "memos_traces"("deleted_at");
ALTER TABLE "memos_traces" ADD CONSTRAINT "memos_traces_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "memos_policies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "scope_type" TEXT NOT NULL,
    "scope_id" UUID,
    "insight" TEXT NOT NULL,
    "confidence" INTEGER NOT NULL DEFAULT 5000,
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "source_traces" UUID[] NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    CONSTRAINT "memos_policies_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "memos_policies_org_category_active_idx" ON "memos_policies"("org_id", "category", "active");
CREATE INDEX IF NOT EXISTS "memos_policies_org_scope_type_scope_id_idx" ON "memos_policies"("org_id", "scope_type", "scope_id");
CREATE INDEX IF NOT EXISTS "memos_policies_org_key_idx" ON "memos_policies"("org_id", "key");
CREATE INDEX IF NOT EXISTS "memos_policies_deleted_at_idx" ON "memos_policies"("deleted_at");
ALTER TABLE "memos_policies" ADD CONSTRAINT "memos_policies_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "memos_world_models" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "domain" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL DEFAULT '{}',
    "trend" TEXT,
    "relevance" INTEGER NOT NULL DEFAULT 5000,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    CONSTRAINT "memos_world_models_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "memos_world_models_org_domain_key_idx" ON "memos_world_models"("org_id", "domain", "key");
CREATE INDEX IF NOT EXISTS "memos_world_models_org_expires_at_idx" ON "memos_world_models"("org_id", "expires_at");
CREATE INDEX IF NOT EXISTS "memos_world_models_deleted_at_idx" ON "memos_world_models"("deleted_at");
ALTER TABLE "memos_world_models" ADD CONSTRAINT "memos_world_models_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "bid_scores" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "opportunity_id" UUID NOT NULL,
    "scored_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "criteria" JSONB NOT NULL DEFAULT '{}',
    "total_score" INTEGER NOT NULL,
    "category_scores" JSONB NOT NULL DEFAULT '{}',
    "weighted_sum" DOUBLE PRECISION NOT NULL,
    "total_weight" DOUBLE PRECISION NOT NULL,
    "ai_suggested" BOOLEAN NOT NULL DEFAULT false,
    "memos_policies" UUID[] NOT NULL DEFAULT '{}',
    "recommendation" TEXT NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    CONSTRAINT "bid_scores_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "bid_scores_org_id_opportunity_id_version_key" UNIQUE ("org_id", "opportunity_id", "version")
);
CREATE INDEX IF NOT EXISTS "bid_scores_org_opportunity_id_idx" ON "bid_scores"("org_id", "opportunity_id");
CREATE INDEX IF NOT EXISTS "bid_scores_org_scored_by_idx" ON "bid_scores"("org_id", "scored_by");
CREATE INDEX IF NOT EXISTS "bid_scores_org_recommendation_idx" ON "bid_scores"("org_id", "recommendation");
CREATE INDEX IF NOT EXISTS "bid_scores_deleted_at_idx" ON "bid_scores"("deleted_at");
ALTER TABLE "bid_scores" ADD CONSTRAINT "bid_scores_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bid_scores" ADD CONSTRAINT "bid_scores_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

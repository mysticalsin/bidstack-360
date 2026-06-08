-- Competitor Intelligence — grounded, cited competitor research (NotebookLM-style).
-- The cite-or-omit guarantee is structural: competitor_insights.source_url is
-- NOT NULL, so an uncited (hallucinated) insight cannot be persisted.
-- See docs/competitor-intel.md.

-- ── Enums ──────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "competitor_insight_category" AS ENUM (
    'pricing', 'win_loss', 'capability', 'positioning', 'rfp_response', 'news', 'other'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "competitor_insight_status" AS ENUM ('active', 'archived', 'superseded');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ── competitor_profiles: standing per-org competitors ──────────────────────
CREATE TABLE IF NOT EXISTS "competitor_profiles" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "name" VARCHAR(200) NOT NULL,
  "normalized_name" VARCHAR(200) NOT NULL,
  "aliases" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "domain" VARCHAR(255),
  "notes" TEXT,
  "created_by_user_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "deleted_at" TIMESTAMPTZ(6),
  CONSTRAINT "competitor_profiles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "competitor_profiles_org_fk" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE
);
-- One active profile per normalized name per org.
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_competitor_org_name"
  ON "competitor_profiles"("org_id", "normalized_name");
CREATE INDEX IF NOT EXISTS "competitor_profiles_org_id_idx" ON "competitor_profiles"("org_id");
CREATE INDEX IF NOT EXISTS "competitor_profiles_deleted_at_idx" ON "competitor_profiles"("deleted_at");

-- ── competitor_insights: grounded, cited findings ──────────────────────────
CREATE TABLE IF NOT EXISTS "competitor_insights" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "competitor_profile_id" UUID NOT NULL,
  "opportunity_id" UUID,
  "category" "competitor_insight_category" NOT NULL DEFAULT 'other',
  "status" "competitor_insight_status" NOT NULL DEFAULT 'active',
  "title" VARCHAR(255) NOT NULL,
  "summary" TEXT NOT NULL,
  -- NOT NULL = the structural no-hallucination guarantee.
  "source_url" TEXT NOT NULL,
  "source_title" TEXT,
  "source_snippet" TEXT,
  "provider" VARCHAR(50) NOT NULL,
  "confidence_bps" INTEGER NOT NULL DEFAULT 0,
  "published_at" TIMESTAMPTZ(6),
  "retrieved_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "deleted_at" TIMESTAMPTZ(6),
  CONSTRAINT "competitor_insights_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "competitor_insights_org_fk" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE,
  CONSTRAINT "competitor_insights_profile_fk" FOREIGN KEY ("competitor_profile_id") REFERENCES "competitor_profiles"("id") ON DELETE CASCADE,
  CONSTRAINT "competitor_insights_opportunity_fk" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "competitor_insights_org_profile_status_idx"
  ON "competitor_insights"("org_id", "competitor_profile_id", "status");
CREATE INDEX IF NOT EXISTS "competitor_insights_org_opp_status_idx"
  ON "competitor_insights"("org_id", "opportunity_id", "status");
CREATE INDEX IF NOT EXISTS "competitor_insights_org_id_category_idx"
  ON "competitor_insights"("org_id", "category");
CREATE INDEX IF NOT EXISTS "competitor_insights_competitor_profile_id_idx"
  ON "competitor_insights"("competitor_profile_id");
CREATE INDEX IF NOT EXISTS "competitor_insights_deleted_at_idx" ON "competitor_insights"("deleted_at");

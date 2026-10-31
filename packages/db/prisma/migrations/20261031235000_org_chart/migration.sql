-- Account org chart (2026-10-31, requested by Tony Walteur 18:57 BRT).
-- Additive only: two new tables, indexes and constraints.

CREATE TABLE "org_charts" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "org_charts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "org_chart_nodes" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "chart_id" UUID NOT NULL,
    "contact_id" UUID,
    "parent_id" UUID,
    "kind" VARCHAR(16) NOT NULL DEFAULT 'contact',
    "name" TEXT NOT NULL,
    "title" TEXT,
    "seniority" "seniority_level" NOT NULL DEFAULT 'unknown',
    "function" VARCHAR(40),
    "business_unit" TEXT,
    "region" VARCHAR(40),
    "photo_url" TEXT,
    "photo_storage_key" TEXT,
    "photo_content_type" VARCHAR(40),
    "relationship_strength" SMALLINT,
    "sentiment" "sentiment",
    "owner_user_id" UUID,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "source" VARCHAR(16) NOT NULL DEFAULT 'manual',
    "external_ref" VARCHAR(160),
    "placement" VARCHAR(16) NOT NULL DEFAULT 'manual',
    "provenance" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "org_chart_nodes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "org_charts_company_id_key" ON "org_charts"("company_id");

CREATE INDEX "org_charts_org_id_idx" ON "org_charts"("org_id");

CREATE INDEX "org_chart_nodes_org_id_chart_id_idx" ON "org_chart_nodes"("org_id", "chart_id");

CREATE INDEX "org_chart_nodes_parent_id_idx" ON "org_chart_nodes"("parent_id");

CREATE INDEX "org_chart_nodes_org_id_contact_id_idx" ON "org_chart_nodes"("org_id", "contact_id");

CREATE INDEX "org_chart_nodes_deleted_at_idx" ON "org_chart_nodes"("deleted_at");

ALTER TABLE "org_charts" ADD CONSTRAINT "org_charts_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "org_charts" ADD CONSTRAINT "org_charts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "org_chart_nodes" ADD CONSTRAINT "org_chart_nodes_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "org_chart_nodes" ADD CONSTRAINT "org_chart_nodes_chart_id_fkey" FOREIGN KEY ("chart_id") REFERENCES "org_charts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "org_chart_nodes" ADD CONSTRAINT "org_chart_nodes_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "org_chart_nodes" ADD CONSTRAINT "org_chart_nodes_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "org_chart_nodes"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "org_chart_nodes" ADD CONSTRAINT "org_chart_nodes_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Exactly one live root per chart (the CEO).
CREATE UNIQUE INDEX "org_chart_nodes_one_root" ON "org_chart_nodes"("chart_id") WHERE "parent_id" IS NULL AND "deleted_at" IS NULL;

-- A contact appears at most once per chart; a seeded prospect at most once per source.
CREATE UNIQUE INDEX "org_chart_nodes_contact_uniq" ON "org_chart_nodes"("chart_id", "contact_id") WHERE "contact_id" IS NOT NULL AND "deleted_at" IS NULL;
CREATE UNIQUE INDEX "org_chart_nodes_external_uniq" ON "org_chart_nodes"("chart_id", "source", "external_ref") WHERE "external_ref" IS NOT NULL AND "deleted_at" IS NULL;

ALTER TABLE "org_chart_nodes" ADD CONSTRAINT "org_chart_nodes_not_self_parent" CHECK ("parent_id" IS NULL OR "parent_id" <> "id");
ALTER TABLE "org_chart_nodes" ADD CONSTRAINT "org_chart_nodes_strength_range" CHECK ("relationship_strength" IS NULL OR "relationship_strength" BETWEEN 1 AND 5);
ALTER TABLE "org_chart_nodes" ADD CONSTRAINT "org_chart_nodes_kind_check" CHECK ("kind" IN ('contact', 'placeholder'));

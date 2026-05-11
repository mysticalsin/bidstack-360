-- CreateTable
CREATE TABLE "company_enrichments" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "legal_name" TEXT NOT NULL,
    "trade_name" TEXT,
    "domain" TEXT,
    "website" TEXT,
    "logo_url" TEXT,
    "logo_source" TEXT,
    "registry_ids" JSONB NOT NULL DEFAULT '{}',
    "address" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT,
    "incorporation_date" DATE,
    "former_names" JSONB NOT NULL DEFAULT '[]',
    "industry_codes" JSONB NOT NULL DEFAULT '[]',
    "employee_count" INTEGER,
    "annual_revenue_micros" BIGINT,
    "confidence_bps" INTEGER NOT NULL DEFAULT 0,
    "source_attribution" JSONB NOT NULL DEFAULT '[]',
    "provider_metadata" JSONB NOT NULL DEFAULT '{}',
    "cache_expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "company_enrichments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_insights" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "company_name" TEXT,
    "opportunity_id" UUID,
    "confidence_bps" INTEGER NOT NULL DEFAULT 0,
    "source_attribution" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_insights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dust_runs" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "mode" TEXT NOT NULL,
    "app_or_tool" TEXT NOT NULL,
    "input" JSONB NOT NULL DEFAULT '{}',
    "output" JSONB,
    "cost_micros" BIGINT,
    "source_attribution" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'queued',
    "error" TEXT,
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dust_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dashboard_widgets" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "x" INTEGER NOT NULL DEFAULT 0,
    "y" INTEGER NOT NULL DEFAULT 0,
    "w" INTEGER NOT NULL DEFAULT 1,
    "h" INTEGER NOT NULL DEFAULT 1,
    "config" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "dashboard_widgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bid_opportunities" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "buyer" TEXT,
    "country" TEXT,
    "region" TEXT,
    "status" TEXT NOT NULL,
    "due_date" TIMESTAMPTZ(6),
    "estimated_value_micros" BIGINT,
    "currency_code" TEXT,
    "url" TEXT,
    "recommendation" TEXT,
    "readiness_score" INTEGER,
    "source_attribution" JSONB NOT NULL DEFAULT '[]',
    "provider_metadata" JSONB NOT NULL DEFAULT '{}',
    "imported_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "bid_opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_register_items" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "opportunity_id" UUID,
    "company_name" TEXT,
    "title" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "owner" TEXT,
    "mitigation" TEXT,
    "due_date" DATE,
    "status" TEXT NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "risk_register_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_checks" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "opportunity_id" UUID,
    "label" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "owner" TEXT,
    "evidence_url" TEXT,
    "source_attribution" JSONB NOT NULL DEFAULT '[]',
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compliance_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proposal_documents" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "opportunity_id" UUID,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "owner" TEXT,
    "storage_url" TEXT,
    "source_attribution" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "proposal_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_health" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "latency_ms" INTEGER,
    "last_checked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "message" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "provider_health_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queue_health" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "queue_name" TEXT NOT NULL,
    "waiting" INTEGER NOT NULL DEFAULT 0,
    "active" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "completed" INTEGER NOT NULL DEFAULT 0,
    "last_checked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "queue_health_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "release_scores" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "functional" INTEGER NOT NULL,
    "code" INTEGER NOT NULL,
    "design" INTEGER NOT NULL,
    "infra" INTEGER NOT NULL,
    "notes" JSONB NOT NULL DEFAULT '[]',
    "scored_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "release_scores_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "company_enrichments_org_domain_idx" ON "company_enrichments"("org_id", "domain");

-- CreateIndex
CREATE INDEX "company_enrichments_org_updated_idx" ON "company_enrichments"("org_id", "updated_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "company_enrichments_org_normalized_name_key" ON "company_enrichments"("org_id", "normalized_name");

-- CreateIndex
CREATE INDEX "ai_insights_org_created_idx" ON "ai_insights"("org_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ai_insights_org_kind_idx" ON "ai_insights"("org_id", "kind");

-- CreateIndex
CREATE INDEX "dust_runs_org_created_idx" ON "dust_runs"("org_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "dust_runs_org_status_idx" ON "dust_runs"("org_id", "status");

-- CreateIndex
CREATE INDEX "dashboard_widgets_layout_idx" ON "dashboard_widgets"("org_id", "y", "x");

-- CreateIndex
CREATE UNIQUE INDEX "dashboard_widgets_org_kind_key" ON "dashboard_widgets"("org_id", "kind");

-- CreateIndex
CREATE INDEX "bid_opportunities_org_due_idx" ON "bid_opportunities"("org_id", "due_date");

-- CreateIndex
CREATE INDEX "bid_opportunities_org_source_idx" ON "bid_opportunities"("org_id", "source");

-- CreateIndex
CREATE UNIQUE INDEX "bid_opportunities_org_source_external_key" ON "bid_opportunities"("org_id", "source", "external_id");

-- CreateIndex
CREATE INDEX "risk_items_org_status_severity_idx" ON "risk_register_items"("org_id", "status", "severity");

-- CreateIndex
CREATE INDEX "compliance_checks_org_status_idx" ON "compliance_checks"("org_id", "status");

-- CreateIndex
CREATE INDEX "proposal_documents_org_status_idx" ON "proposal_documents"("org_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "provider_health_org_provider_key" ON "provider_health"("org_id", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "queue_health_org_queue_key" ON "queue_health"("org_id", "queue_name");

-- CreateIndex
CREATE INDEX "release_scores_org_scored_idx" ON "release_scores"("org_id", "scored_at" DESC);

-- AddForeignKey
ALTER TABLE "company_enrichments" ADD CONSTRAINT "company_enrichments_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_insights" ADD CONSTRAINT "ai_insights_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dust_runs" ADD CONSTRAINT "dust_runs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dashboard_widgets" ADD CONSTRAINT "dashboard_widgets_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_opportunities" ADD CONSTRAINT "bid_opportunities_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_register_items" ADD CONSTRAINT "risk_register_items_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_checks" ADD CONSTRAINT "compliance_checks_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_documents" ADD CONSTRAINT "proposal_documents_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_health" ADD CONSTRAINT "provider_health_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_health" ADD CONSTRAINT "queue_health_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "release_scores" ADD CONSTRAINT "release_scores_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- CreateTable
CREATE TABLE "analytics_reports" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "owner_id" UUID NOT NULL,
    "query" JSONB NOT NULL,
    "chart_type" TEXT NOT NULL DEFAULT 'table',
    "schedule" TEXT,
    "last_run_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "analytics_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_report_runs" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "report_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),
    "row_count" INTEGER,
    "result" JSONB,
    "error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_report_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_dashboards" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "owner_id" UUID NOT NULL,
    "is_shared" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "analytics_dashboards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_dashboard_widgets" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "dashboard_id" UUID NOT NULL,
    "report_id" UUID,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "position" JSONB NOT NULL DEFAULT '{"x": 0, "y": 0, "w": 4, "h": 3}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "analytics_dashboard_widgets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "analytics_reports_org_created_idx" ON "analytics_reports"("org_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "analytics_reports_org_id_idx" ON "analytics_reports"("org_id");

-- CreateIndex
CREATE INDEX "analytics_reports_deleted_at_idx" ON "analytics_reports"("deleted_at");

-- CreateIndex
CREATE INDEX "analytics_report_runs_org_report_created_idx" ON "analytics_report_runs"("org_id", "report_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "analytics_dashboards_org_created_idx" ON "analytics_dashboards"("org_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "analytics_dashboards_org_id_idx" ON "analytics_dashboards"("org_id");

-- CreateIndex
CREATE INDEX "analytics_dashboards_deleted_at_idx" ON "analytics_dashboards"("deleted_at");

-- CreateIndex
CREATE INDEX "analytics_dashboard_widgets_org_dash_idx" ON "analytics_dashboard_widgets"("org_id", "dashboard_id");

-- CreateIndex
CREATE INDEX "analytics_dashboard_widgets_report_id_idx" ON "analytics_dashboard_widgets"("report_id");

-- AddForeignKey
ALTER TABLE "analytics_reports" ADD CONSTRAINT "analytics_reports_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics_report_runs" ADD CONSTRAINT "analytics_report_runs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics_report_runs" ADD CONSTRAINT "analytics_report_runs_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "analytics_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics_dashboards" ADD CONSTRAINT "analytics_dashboards_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics_dashboard_widgets" ADD CONSTRAINT "analytics_dashboard_widgets_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics_dashboard_widgets" ADD CONSTRAINT "analytics_dashboard_widgets_dashboard_id_fkey" FOREIGN KEY ("dashboard_id") REFERENCES "analytics_dashboards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics_dashboard_widgets" ADD CONSTRAINT "analytics_dashboard_widgets_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "analytics_reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;


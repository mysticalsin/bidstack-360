-- Slice 12 account intelligence: job board postings (department, sample),
-- company posts, evidence ledger, investment themes and per-source refresh runs.
-- Tenant scoped by org_id on every table; cascades with the org and company.
-- Retention: postings unseen for 180 days and posts or evidence older than
-- 3 years are pruned by the account-intel worker. investment_themes is derived.
-- AlterTable
ALTER TABLE "account_watch_subjects" ADD COLUMN     "ats_board" TEXT,
ADD COLUMN     "ats_provider" TEXT,
ADD COLUMN     "brreg_org_number" TEXT,
ADD COLUMN     "careers_url" TEXT,
ADD COLUMN     "fr_siren" TEXT,
ADD COLUMN     "newsroom_url" TEXT;

-- AlterTable
ALTER TABLE "company_job_postings" ADD COLUMN     "department" TEXT,
ADD COLUMN     "sample" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "company_posts" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "url" TEXT,
    "title" TEXT NOT NULL,
    "excerpt" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "theme" TEXT,
    "published_at" TIMESTAMPTZ(6),
    "fetched_at" TIMESTAMPTZ(6) NOT NULL,
    "sample" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "company_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intel_evidence" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT,
    "url" TEXT,
    "excerpt" TEXT NOT NULL,
    "locator" TEXT,
    "stance" TEXT,
    "theme" TEXT,
    "fetched_at" TIMESTAMPTZ(6) NOT NULL,
    "sample" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "intel_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investment_themes" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "direction" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "theme" TEXT,
    "label" TEXT NOT NULL,
    "amount" DOUBLE PRECISION,
    "currency" TEXT,
    "trend_pct" DOUBLE PRECISION,
    "basis" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "evidence_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "computed_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "investment_themes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intel_source_runs" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "last_fetched_at" TIMESTAMPTZ(6),
    "result" JSONB NOT NULL DEFAULT '{}',
    "detail" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "intel_source_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "company_posts_org_id_company_id_published_at_idx" ON "company_posts"("org_id", "company_id", "published_at");

-- CreateIndex
CREATE UNIQUE INDEX "company_posts_org_id_company_id_source_external_id_key" ON "company_posts"("org_id", "company_id", "source", "external_id");

-- CreateIndex
CREATE INDEX "intel_evidence_org_id_company_id_kind_idx" ON "intel_evidence"("org_id", "company_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "intel_evidence_org_id_company_id_source_key_key" ON "intel_evidence"("org_id", "company_id", "source", "key");

-- CreateIndex
CREATE INDEX "investment_themes_org_id_company_id_direction_idx" ON "investment_themes"("org_id", "company_id", "direction");

-- CreateIndex
CREATE UNIQUE INDEX "intel_source_runs_org_id_company_id_source_key" ON "intel_source_runs"("org_id", "company_id", "source");

-- AddForeignKey
ALTER TABLE "company_posts" ADD CONSTRAINT "company_posts_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_posts" ADD CONSTRAINT "company_posts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intel_evidence" ADD CONSTRAINT "intel_evidence_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intel_evidence" ADD CONSTRAINT "intel_evidence_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment_themes" ADD CONSTRAINT "investment_themes_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment_themes" ADD CONSTRAINT "investment_themes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intel_source_runs" ADD CONSTRAINT "intel_source_runs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intel_source_runs" ADD CONSTRAINT "intel_source_runs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;


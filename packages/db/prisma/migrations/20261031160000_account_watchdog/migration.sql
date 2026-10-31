-- CreateEnum
CREATE TYPE "watchdog_event_kind" AS ENUM ('EARNINGS_RELEASE', 'EARNINGS_DATE', 'ANNUAL_REPORT', 'QUARTERLY_REPORT', 'FILING', 'GUIDANCE_CHANGE', 'M_AND_A', 'RESTRUCTURING', 'LEADERSHIP_CHANGE', 'INSOLVENCY', 'OTHER_DISCLOSURE', 'NEWS_SIGNAL');

-- CreateEnum
CREATE TYPE "watchdog_implication" AS ENUM ('OPPORTUNITY', 'RISK', 'NEUTRAL');

-- CreateEnum
CREATE TYPE "watchdog_event_status" AS ENUM ('NEW', 'ACKNOWLEDGED', 'DISMISSED', 'ACTIONED');

-- CreateTable
CREATE TABLE "account_watch_subjects" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "sec_cik" TEXT,
    "companies_house_number" TEXT,
    "lei" TEXT,
    "ticker" TEXT,
    "exchange" TEXT,
    "ir_feed_url" TEXT,
    "identifiers_confirmed_by_id" UUID,
    "identifiers_confirmed_at" TIMESTAMPTZ(6),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_checked_at" TIMESTAMPTZ(6),
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "account_watch_subjects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_watch_events" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "kind" "watchdog_event_kind" NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "detected_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "title" TEXT NOT NULL,
    "source_url" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "summary_source" TEXT NOT NULL DEFAULT 'RULE',
    "implication" "watchdog_implication" NOT NULL DEFAULT 'NEUTRAL',
    "implication_rationale" TEXT,
    "severity" INTEGER NOT NULL DEFAULT 1,
    "confirmed" BOOLEAN NOT NULL DEFAULT true,
    "status" "watchdog_event_status" NOT NULL DEFAULT 'NEW',
    "linked_opportunity_id" UUID,
    "payload" JSONB,

    CONSTRAINT "account_watch_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_earnings_dates" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "fiscal_period" TEXT NOT NULL,
    "expected_at" TIMESTAMPTZ(6) NOT NULL,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL,
    "source_url" TEXT NOT NULL,
    "retrieved_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_earnings_dates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "account_watch_subjects_enabled_last_checked_at_idx" ON "account_watch_subjects"("enabled", "last_checked_at");

-- CreateIndex
CREATE UNIQUE INDEX "account_watch_subjects_org_id_company_id_key" ON "account_watch_subjects"("org_id", "company_id");

-- CreateIndex
CREATE INDEX "account_watch_events_org_id_company_id_occurred_at_idx" ON "account_watch_events"("org_id", "company_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "account_watch_events_org_id_status_severity_idx" ON "account_watch_events"("org_id", "status", "severity");

-- CreateIndex
CREATE UNIQUE INDEX "account_watch_events_org_id_source_external_id_key" ON "account_watch_events"("org_id", "source", "external_id");

-- CreateIndex
CREATE INDEX "account_earnings_dates_org_id_expected_at_idx" ON "account_earnings_dates"("org_id", "expected_at");

-- CreateIndex
CREATE UNIQUE INDEX "account_earnings_dates_org_id_company_id_fiscal_period_key" ON "account_earnings_dates"("org_id", "company_id", "fiscal_period");

-- AddForeignKey
ALTER TABLE "account_watch_subjects" ADD CONSTRAINT "account_watch_subjects_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_watch_subjects" ADD CONSTRAINT "account_watch_subjects_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_watch_events" ADD CONSTRAINT "account_watch_events_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_watch_events" ADD CONSTRAINT "account_watch_events_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_earnings_dates" ADD CONSTRAINT "account_earnings_dates_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_earnings_dates" ADD CONSTRAINT "account_earnings_dates_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;


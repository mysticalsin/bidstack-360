-- Compliance pack (expand only): per-org data residency tag and the GDPR data
-- subject request ledger. Rollback without data loss: the column is nullable
-- and the table is new; both can stay until a contract step after sign-off.

-- AlterTable
ALTER TABLE "org_settings" ADD COLUMN "data_region" VARCHAR(8);

-- CreateTable
CREATE TABLE "data_subject_requests" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "requested_by_id" UUID,
    "kind" VARCHAR(16) NOT NULL,
    "subject_type" VARCHAR(32) NOT NULL,
    "subject_id" UUID NOT NULL,
    "dry_run" BOOLEAN NOT NULL DEFAULT true,
    "status" VARCHAR(16) NOT NULL DEFAULT 'queued',
    "report" JSONB,
    "error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "data_subject_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "data_subject_requests_org_id_created_at_idx" ON "data_subject_requests"("org_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "data_subject_requests_status_created_at_idx" ON "data_subject_requests"("status", "created_at");

-- AddForeignKey
ALTER TABLE "data_subject_requests" ADD CONSTRAINT "data_subject_requests_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

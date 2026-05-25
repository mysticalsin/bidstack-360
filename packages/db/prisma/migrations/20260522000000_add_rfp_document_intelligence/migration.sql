-- RFP document intelligence foundation.
-- Adds versioned bid documents, source chunks, requirements, compliance rows,
-- review issues, approval gates, and submission packages.

CREATE TYPE "rfp_document_type" AS ENUM (
    'rfp',
    'rfi',
    'rfq',
    'amendment',
    'attachment',
    'proposal',
    'reference',
    'legal',
    'pricing',
    'security',
    'other'
);

CREATE TYPE "rfp_document_status" AS ENUM (
    'intake',
    'pending_extraction',
    'extracting',
    'ready',
    'failed',
    'superseded',
    'archived'
);

CREATE TYPE "rfp_job_status" AS ENUM (
    'pending',
    'queued',
    'running',
    'retrying',
    'succeeded',
    'failed',
    'cancelled'
);

CREATE TYPE "requirement_status" AS ENUM (
    'suggested',
    'accepted',
    'in_progress',
    'answered',
    'waived',
    'rejected',
    'blocked'
);

CREATE TYPE "compliance_row_status" AS ENUM (
    'open',
    'in_progress',
    'ready_for_review',
    'approved',
    'blocked',
    'waived'
);

CREATE TYPE "rfp_risk_level" AS ENUM ('low', 'medium', 'high', 'critical');

CREATE TYPE "review_issue_status" AS ENUM (
    'open',
    'acknowledged',
    'in_progress',
    'resolved',
    'waived'
);

CREATE TYPE "approval_gate_status" AS ENUM ('pending', 'approved', 'rejected', 'waived');

CREATE TYPE "submission_package_status" AS ENUM (
    'draft',
    'locked',
    'submitted',
    'accepted',
    'rejected',
    'archived'
);

CREATE TABLE "bid_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "opportunity_id" UUID,
    "company_id" UUID,
    "account_id" VARCHAR(255),
    "title" VARCHAR(255) NOT NULL,
    "document_type" "rfp_document_type" NOT NULL DEFAULT 'other',
    "status" "rfp_document_status" NOT NULL DEFAULT 'intake',
    "source" VARCHAR(100) NOT NULL DEFAULT 'upload',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "bid_documents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "document_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "bid_document_id" UUID NOT NULL,
    "version_no" INTEGER NOT NULL,
    "file_attachment_id" UUID,
    "storage_key" VARCHAR(500) NOT NULL,
    "content_type" VARCHAR(100) NOT NULL,
    "bytes" INTEGER NOT NULL,
    "checksum" VARCHAR(128),
    "etag" VARCHAR(255),
    "source_hash" VARCHAR(128),
    "ocr_status" "rfp_job_status" NOT NULL DEFAULT 'pending',
    "extraction_status" "rfp_job_status" NOT NULL DEFAULT 'pending',
    "ocr_engine" VARCHAR(100),
    "extracted_text" TEXT,
    "layout_json" JSONB NOT NULL DEFAULT '{}',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "document_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "source_chunks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "bid_document_id" UUID NOT NULL,
    "document_version_id" UUID NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "page_start" INTEGER,
    "page_end" INTEGER,
    "section_path" VARCHAR(500),
    "locator" JSONB NOT NULL DEFAULT '{}',
    "text" TEXT NOT NULL,
    "hash" VARCHAR(128),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "source_chunks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "requirements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "opportunity_id" UUID,
    "bid_document_id" UUID,
    "document_version_id" UUID,
    "source_chunk_id" UUID,
    "external_ref" VARCHAR(100),
    "text" TEXT NOT NULL,
    "requirement_type" VARCHAR(100) NOT NULL DEFAULT 'general',
    "mandatory" BOOLEAN NOT NULL DEFAULT false,
    "priority" "rfp_risk_level" NOT NULL DEFAULT 'medium',
    "status" "requirement_status" NOT NULL DEFAULT 'suggested',
    "confidence_bps" INTEGER NOT NULL DEFAULT 0,
    "owner_id" UUID,
    "due_date" DATE,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "requirements_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "compliance_matrix_rows" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "opportunity_id" UUID,
    "requirement_id" UUID NOT NULL,
    "owner_id" UUID,
    "status" "compliance_row_status" NOT NULL DEFAULT 'open',
    "risk" "rfp_risk_level" NOT NULL DEFAULT 'medium',
    "response_status" VARCHAR(100) NOT NULL DEFAULT 'not_started',
    "answer_draft" TEXT,
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "citations" JSONB NOT NULL DEFAULT '[]',
    "due_date" DATE,
    "approved_at" TIMESTAMPTZ(6),
    "approver_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "compliance_matrix_rows_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "review_issues" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "opportunity_id" UUID,
    "requirement_id" UUID,
    "source_chunk_id" UUID,
    "category" VARCHAR(100) NOT NULL,
    "severity" "rfp_risk_level" NOT NULL DEFAULT 'medium',
    "status" "review_issue_status" NOT NULL DEFAULT 'open',
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT NOT NULL,
    "recommendation" TEXT,
    "owner_id" UUID,
    "resolved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "review_issues_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "approval_gates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "opportunity_id" UUID,
    "bid_document_id" UUID,
    "locked_version_id" UUID,
    "gate_key" VARCHAR(100) NOT NULL,
    "status" "approval_gate_status" NOT NULL DEFAULT 'pending',
    "approver_user_id" UUID,
    "decision_notes" TEXT,
    "decided_at" TIMESTAMPTZ(6),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "approval_gates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "submission_packages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "opportunity_id" UUID,
    "name" VARCHAR(255) NOT NULL,
    "status" "submission_package_status" NOT NULL DEFAULT 'draft',
    "contents" JSONB NOT NULL DEFAULT '[]',
    "receipt" JSONB,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "locked_at" TIMESTAMPTZ(6),
    "submitted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "submission_packages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "bid_documents_org_opp_status_idx" ON "bid_documents"("org_id", "opportunity_id", "status");
CREATE INDEX "bid_documents_org_company_id_idx" ON "bid_documents"("org_id", "company_id");
CREATE INDEX "bid_documents_org_account_id_idx" ON "bid_documents"("org_id", "account_id");
CREATE INDEX "bid_documents_deleted_at_idx" ON "bid_documents"("deleted_at");

CREATE UNIQUE INDEX "document_versions_org_doc_version_key" ON "document_versions"("org_id", "bid_document_id", "version_no");
CREATE INDEX "document_versions_org_doc_created_idx" ON "document_versions"("org_id", "bid_document_id", "created_at" DESC);
CREATE INDEX "document_versions_org_job_status_idx" ON "document_versions"("org_id", "ocr_status", "extraction_status");
CREATE INDEX "document_versions_deleted_at_idx" ON "document_versions"("deleted_at");

CREATE UNIQUE INDEX "source_chunks_org_version_chunk_key" ON "source_chunks"("org_id", "document_version_id", "chunk_index");
CREATE INDEX "source_chunks_org_bid_document_id_idx" ON "source_chunks"("org_id", "bid_document_id");
CREATE INDEX "source_chunks_org_hash_idx" ON "source_chunks"("org_id", "hash");
CREATE INDEX "source_chunks_deleted_at_idx" ON "source_chunks"("deleted_at");

CREATE INDEX "requirements_org_opp_status_idx" ON "requirements"("org_id", "opportunity_id", "status");
CREATE INDEX "requirements_org_bid_document_id_idx" ON "requirements"("org_id", "bid_document_id");
CREATE INDEX "requirements_org_owner_id_idx" ON "requirements"("org_id", "owner_id");
CREATE INDEX "requirements_deleted_at_idx" ON "requirements"("deleted_at");

CREATE UNIQUE INDEX "compliance_matrix_rows_requirement_id_key" ON "compliance_matrix_rows"("requirement_id");
CREATE INDEX "compliance_rows_org_opp_status_idx" ON "compliance_matrix_rows"("org_id", "opportunity_id", "status");
CREATE INDEX "compliance_matrix_rows_org_owner_id_idx" ON "compliance_matrix_rows"("org_id", "owner_id");
CREATE INDEX "compliance_matrix_rows_deleted_at_idx" ON "compliance_matrix_rows"("deleted_at");

CREATE INDEX "review_issues_org_opp_status_idx" ON "review_issues"("org_id", "opportunity_id", "status");
CREATE INDEX "review_issues_org_severity_status_idx" ON "review_issues"("org_id", "severity", "status");
CREATE INDEX "review_issues_org_owner_id_idx" ON "review_issues"("org_id", "owner_id");
CREATE INDEX "review_issues_deleted_at_idx" ON "review_issues"("deleted_at");

CREATE INDEX "approval_gates_org_opp_status_idx" ON "approval_gates"("org_id", "opportunity_id", "status");
CREATE INDEX "approval_gates_org_gate_key_idx" ON "approval_gates"("org_id", "gate_key");
CREATE INDEX "approval_gates_deleted_at_idx" ON "approval_gates"("deleted_at");

CREATE INDEX "submission_packages_org_opp_status_idx" ON "submission_packages"("org_id", "opportunity_id", "status");
CREATE INDEX "submission_packages_deleted_at_idx" ON "submission_packages"("deleted_at");

ALTER TABLE "bid_documents" ADD CONSTRAINT "bid_documents_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bid_documents" ADD CONSTRAINT "bid_documents_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "bid_documents" ADD CONSTRAINT "bid_documents_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_bid_document_id_fkey" FOREIGN KEY ("bid_document_id") REFERENCES "bid_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_file_attachment_id_fkey" FOREIGN KEY ("file_attachment_id") REFERENCES "file_attachments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "source_chunks" ADD CONSTRAINT "source_chunks_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "source_chunks" ADD CONSTRAINT "source_chunks_bid_document_id_fkey" FOREIGN KEY ("bid_document_id") REFERENCES "bid_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "source_chunks" ADD CONSTRAINT "source_chunks_document_version_id_fkey" FOREIGN KEY ("document_version_id") REFERENCES "document_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "requirements" ADD CONSTRAINT "requirements_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_bid_document_id_fkey" FOREIGN KEY ("bid_document_id") REFERENCES "bid_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_document_version_id_fkey" FOREIGN KEY ("document_version_id") REFERENCES "document_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_source_chunk_id_fkey" FOREIGN KEY ("source_chunk_id") REFERENCES "source_chunks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "compliance_matrix_rows" ADD CONSTRAINT "compliance_matrix_rows_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "compliance_matrix_rows" ADD CONSTRAINT "compliance_matrix_rows_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "compliance_matrix_rows" ADD CONSTRAINT "compliance_matrix_rows_requirement_id_fkey" FOREIGN KEY ("requirement_id") REFERENCES "requirements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "review_issues" ADD CONSTRAINT "review_issues_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "review_issues" ADD CONSTRAINT "review_issues_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "review_issues" ADD CONSTRAINT "review_issues_requirement_id_fkey" FOREIGN KEY ("requirement_id") REFERENCES "requirements"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "review_issues" ADD CONSTRAINT "review_issues_source_chunk_id_fkey" FOREIGN KEY ("source_chunk_id") REFERENCES "source_chunks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "approval_gates" ADD CONSTRAINT "approval_gates_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "approval_gates" ADD CONSTRAINT "approval_gates_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "approval_gates" ADD CONSTRAINT "approval_gates_bid_document_id_fkey" FOREIGN KEY ("bid_document_id") REFERENCES "bid_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "approval_gates" ADD CONSTRAINT "approval_gates_locked_version_id_fkey" FOREIGN KEY ("locked_version_id") REFERENCES "document_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "submission_packages" ADD CONSTRAINT "submission_packages_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "submission_packages" ADD CONSTRAINT "submission_packages_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

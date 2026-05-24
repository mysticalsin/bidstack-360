-- GDPR tenant export (Art. 20 portability) — adds the TenantExport table
-- and its driving status enum. Hand-crafted because the team regenerates the
-- Prisma client between sessions; do not modify after the first deploy.

CREATE TYPE "tenant_export_status" AS ENUM (
    'pending',
    'running',
    'ready',
    'failed',
    'expired'
);

CREATE TABLE "tenant_exports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "requested_by_id" UUID NOT NULL,
    "status" "tenant_export_status" NOT NULL DEFAULT 'pending',
    "download_url" TEXT,
    "expires_at" TIMESTAMPTZ(6),
    "error" TEXT,
    "size_bytes" BIGINT,
    "storage_key" TEXT,
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "tenant_exports_pkey" PRIMARY KEY ("id")
);

-- Tenant scoping + listing order (most recent first per org)
CREATE INDEX "tenant_exports_org_created_idx"
    ON "tenant_exports"("org_id", "created_at" DESC);

-- Used by the API to surface in-flight exports and by the cleanup job
-- to find rows whose underlying S3 object must be lifecycle-deleted.
CREATE INDEX "tenant_exports_org_status_idx"
    ON "tenant_exports"("org_id", "status");

-- Soft-delete sweep predicate (matches the codebase convention).
CREATE INDEX "tenant_exports_deleted_at_idx"
    ON "tenant_exports"("deleted_at");

-- Cascade with the org (consistent with every other tenant table). The
-- user FK is a no-action restrict: deleting a requester preserves the
-- audit trail of who initiated which export.
ALTER TABLE "tenant_exports"
    ADD CONSTRAINT "tenant_exports_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tenant_exports"
    ADD CONSTRAINT "tenant_exports_requested_by_id_fkey"
    FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

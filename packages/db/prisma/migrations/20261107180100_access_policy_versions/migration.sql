-- Access policy versions: When / Then / Except rules layered on the RBAC
-- matrix, with a two-admin approval queue and versioned publish (expand only).
CREATE TYPE "access_policy_status" AS ENUM ('draft', 'pending', 'approved', 'rejected', 'published', 'superseded');

CREATE TABLE "access_policy_versions" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "version" INTEGER,
    "name" TEXT NOT NULL,
    "status" "access_policy_status" NOT NULL DEFAULT 'draft',
    "rules" JSONB NOT NULL DEFAULT '[]',
    "created_by_id" UUID NOT NULL,
    "submitted_by_id" UUID,
    "submitted_at" TIMESTAMPTZ(6),
    "approved_by_id" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "decision_note" TEXT,
    "published_by_id" UUID,
    "published_at" TIMESTAMPTZ(6),
    "rollback_of_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "access_policy_versions_pkey" PRIMARY KEY ("id"),
    -- Nobody approves their own policy, even through a direct write.
    CONSTRAINT "access_policy_versions_no_self_approval" CHECK (
      "approved_by_id" IS NULL
      OR ("approved_by_id" <> "created_by_id"
          AND ("submitted_by_id" IS NULL OR "approved_by_id" <> "submitted_by_id"))
    )
);

CREATE UNIQUE INDEX "access_policy_versions_org_version_key" ON "access_policy_versions"("org_id", "version");

CREATE INDEX "access_policy_versions_org_status_idx" ON "access_policy_versions"("org_id", "status", "created_at" DESC);

-- One live version per org.
CREATE UNIQUE INDEX "access_policy_versions_one_published_idx" ON "access_policy_versions"("org_id") WHERE "status" = 'published';

ALTER TABLE "access_policy_versions" ADD CONSTRAINT "access_policy_versions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

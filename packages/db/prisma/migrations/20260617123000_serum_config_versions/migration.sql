-- CreateTable
CREATE TABLE "serum_config_versions" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "config_type" VARCHAR(80) NOT NULL,
    "config_key" VARCHAR(120) NOT NULL,
    "version" INTEGER NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'draft',
    "environment" VARCHAR(30) NOT NULL DEFAULT 'dev',
    "config_json" JSONB NOT NULL DEFAULT '{}',
    "created_by_user_id" UUID,
    "approved_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activated_at" TIMESTAMPTZ(6),
    "rollback_of_config_version_id" UUID,
    "change_reason" VARCHAR(500) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "serum_config_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "serum_config_versions_lookup_idx" ON "serum_config_versions"("org_id", "config_type", "config_key", "environment", "status");

-- CreateIndex
CREATE INDEX "serum_config_versions_org_created_idx" ON "serum_config_versions"("org_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "serum_config_versions_rollback_idx" ON "serum_config_versions"("rollback_of_config_version_id");

-- CreateIndex
CREATE INDEX "serum_config_versions_deleted_at_idx" ON "serum_config_versions"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "serum_config_versions_org_key_version_key" ON "serum_config_versions"("org_id", "config_type", "config_key", "environment", "version");

-- AddForeignKey
ALTER TABLE "serum_config_versions" ADD CONSTRAINT "serum_config_versions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

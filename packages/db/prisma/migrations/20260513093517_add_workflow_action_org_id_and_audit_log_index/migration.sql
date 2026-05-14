-- Ensure workflow tables exist (created via db push in dev; needed for shadow DB replay)
CREATE TABLE IF NOT EXISTS "workflows" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "trigger_kind" TEXT NOT NULL,
    "trigger_config" JSONB DEFAULT '{}',
    "run_count" INTEGER NOT NULL DEFAULT 0,
    "last_run_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    CONSTRAINT "workflows_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "workflow_actions" (
    "id" UUID NOT NULL,
    "workflow_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "config" JSONB DEFAULT '{}',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    CONSTRAINT "workflow_actions_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE IF EXISTS "workflow_actions" ADD COLUMN     "org_id" UUID;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "audit_log_org_id_target_type_target_id_at_idx" ON "audit_log"("org_id", "target_type", "target_id", "at" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "workflow_actions_org_id_idx" ON "workflow_actions"("org_id");

-- AddForeignKey
ALTER TABLE IF EXISTS "workflow_actions" ADD CONSTRAINT "workflow_actions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

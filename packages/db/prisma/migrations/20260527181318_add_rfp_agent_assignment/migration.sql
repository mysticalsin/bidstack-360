-- CreateEnum
CREATE TYPE "rfp_agent_assignment_status" AS ENUM ('active', 'paused');

-- CreateTable
CREATE TABLE "rfp_agent_assignments" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "agent_id" UUID NOT NULL,
    "rfp_request_id" TEXT NOT NULL,
    "status" "rfp_agent_assignment_status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "rfp_agent_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rfp_agent_assignments_org_rfp_status_idx" ON "rfp_agent_assignments"("org_id", "rfp_request_id", "status");

-- CreateIndex
CREATE INDEX "rfp_agent_assignments_agent_rfp_idx" ON "rfp_agent_assignments"("agent_id", "rfp_request_id");

-- CreateIndex
CREATE INDEX "rfp_agent_assignments_deleted_at_idx" ON "rfp_agent_assignments"("deleted_at");

-- AddForeignKey
ALTER TABLE "rfp_agent_assignments" ADD CONSTRAINT "rfp_agent_assignments_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfp_agent_assignments" ADD CONSTRAINT "rfp_agent_assignments_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

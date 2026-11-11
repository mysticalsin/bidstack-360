-- AlterTable
ALTER TABLE "migration_jobs" ADD COLUMN     "upload_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "migration_jobs_org_upload_key" ON "migration_jobs"("org_id", "upload_id");


-- DropForeignKey
ALTER TABLE "company_field_overrides" DROP CONSTRAINT "company_field_overrides_company_id_fkey";

-- DropIndex
DROP INDEX "company_field_overrides_org_company_field_key";

-- DropIndex
DROP INDEX "company_field_overrides_org_id_company_id_idx";

-- AlterTable
ALTER TABLE "company_field_overrides" DROP COLUMN "company_id",
ADD COLUMN     "company_key" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "company_field_overrides_org_id_company_key_idx" ON "company_field_overrides"("org_id", "company_key");

-- CreateIndex
CREATE UNIQUE INDEX "company_field_overrides_org_company_field_key" ON "company_field_overrides"("org_id", "company_key", "field_key");


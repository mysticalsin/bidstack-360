-- AlterTable
ALTER TABLE "contract_agreements" ADD COLUMN     "source_extraction_id" UUID,
ADD COLUMN     "source_file_id" UUID;

-- AddForeignKey
ALTER TABLE "contract_agreements" ADD CONSTRAINT "contract_agreements_source_file_id_fkey" FOREIGN KEY ("source_file_id") REFERENCES "file_attachments"("id") ON DELETE SET NULL ON UPDATE CASCADE;


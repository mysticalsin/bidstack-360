-- CreateTable
CREATE TABLE "file_attachments" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "account_id" VARCHAR(255) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "content_type" VARCHAR(100) NOT NULL,
    "bytes" INTEGER NOT NULL,
    "storage_key" VARCHAR(500) NOT NULL,
    "uploaded_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "file_attachments_org_account_created_idx" ON "file_attachments"("org_id", "account_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "file_attachments" ADD CONSTRAINT "file_attachments_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_attachments" ADD CONSTRAINT "file_attachments_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

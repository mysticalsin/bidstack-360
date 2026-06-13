-- CreateTable
CREATE TABLE "company_field_overrides" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "field_key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "overridden_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "company_field_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "company_field_overrides_org_id_company_id_idx" ON "company_field_overrides"("org_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "company_field_overrides_org_company_field_key" ON "company_field_overrides"("org_id", "company_id", "field_key");

-- AddForeignKey
ALTER TABLE "company_field_overrides" ADD CONSTRAINT "company_field_overrides_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_field_overrides" ADD CONSTRAINT "company_field_overrides_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;


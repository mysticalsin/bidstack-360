-- Slice 9: external record ids (CRM account id, Dust entity id) mapped to Polo companies and opportunities for the inbound activity API.
-- CreateTable
CREATE TABLE "external_record_links" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "source" VARCHAR(40) NOT NULL,
    "entity_type" VARCHAR(20) NOT NULL,
    "external_id" VARCHAR(200) NOT NULL,
    "entity_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "external_record_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "external_record_links_org_id_entity_type_entity_id_idx" ON "external_record_links"("org_id", "entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "external_record_links_org_source_type_ext_key" ON "external_record_links"("org_id", "source", "entity_type", "external_id");

-- AddForeignKey
ALTER TABLE "external_record_links" ADD CONSTRAINT "external_record_links_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;


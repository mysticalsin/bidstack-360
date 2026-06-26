-- Sales toolkit store: stored sales collateral (decks/templates/battle-cards),
-- SharePoint-sourced or manual, readable by the MCP.
CREATE TABLE "sales_toolkits" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "description" TEXT,
    "category" VARCHAR(40) NOT NULL DEFAULT 'other',
    "sector_tags" TEXT[],
    "url" VARCHAR(2000),
    "source" VARCHAR(20) NOT NULL DEFAULT 'manual',
    "external_id" VARCHAR(255),
    "added_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    CONSTRAINT "sales_toolkits_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sales_toolkits_org_source_external_key" ON "sales_toolkits"("org_id", "source", "external_id");
CREATE INDEX "sales_toolkits_org_id_idx" ON "sales_toolkits"("org_id");
CREATE INDEX "sales_toolkits_org_id_source_idx" ON "sales_toolkits"("org_id", "source");
CREATE INDEX "sales_toolkits_deleted_at_idx" ON "sales_toolkits"("deleted_at");

ALTER TABLE "sales_toolkits" ADD CONSTRAINT "sales_toolkits_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

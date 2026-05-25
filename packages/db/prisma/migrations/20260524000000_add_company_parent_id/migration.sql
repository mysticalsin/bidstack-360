-- Add parent_id self-relation to companies for account hierarchy

ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "parent_id" UUID;

ALTER TABLE "companies" ADD CONSTRAINT "companies_parent_id_fkey"
    FOREIGN KEY ("parent_id") REFERENCES "companies"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "companies_parent_id_idx" ON "companies"("parent_id");

-- Add soft-delete support to references table
ALTER TABLE "references" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ(6);
CREATE INDEX IF NOT EXISTS "references_deleted_at_idx" ON "references"("deleted_at");

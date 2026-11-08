-- Slice 22: provenance on manual company field overrides. Additive and
-- nullable, so existing rows stay valid and older API builds keep working.
-- overridden_by_id already records who saved the value.

-- AlterTable
ALTER TABLE "company_field_overrides" ADD COLUMN "source_url" VARCHAR(2048),
ADD COLUMN "source_label" VARCHAR(120);

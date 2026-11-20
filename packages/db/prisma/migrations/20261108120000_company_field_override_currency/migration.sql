-- Slice 22: currency of a manual revenue override. Additive and nullable;
-- existing rows keep reading as EUR, which is what they were entered in.

-- AlterTable
ALTER TABLE "company_field_overrides" ADD COLUMN "currency" VARCHAR(3);

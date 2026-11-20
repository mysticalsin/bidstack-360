-- B2: API keys can be scoped to companies/MSAs and marked read-only.
-- Existing keys stay org-wide and writable. New keys default-deny + read-only.
ALTER TABLE "api_keys" ADD COLUMN "unrestricted_scope" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "api_keys" ADD COLUMN "read_only" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "api_keys" ADD COLUMN "company_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[];
ALTER TABLE "api_keys" ADD COLUMN "msa_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[];

UPDATE "api_keys"
SET "unrestricted_scope" = true,
    "read_only" = false;

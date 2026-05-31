-- AlterTable: add optional expiry to api_keys
-- Closes schema drift introduced when ApiKey.expiresAt was added to
-- schema.prisma (commit ee909d4b) without a corresponding migration.
ALTER TABLE "api_keys" ADD COLUMN "expires_at" TIMESTAMPTZ(6);

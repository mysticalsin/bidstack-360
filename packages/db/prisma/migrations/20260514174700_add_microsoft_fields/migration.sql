-- Add Microsoft 365 integration fields to User
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "microsoft_account_json" JSONB;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "microsoft_connected_at" TIMESTAMPTZ(6);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "microsoft_email" TEXT;

-- Add Microsoft Entra ID / SSO configuration to Org
ALTER TABLE "orgs" ADD COLUMN IF NOT EXISTS "microsoft_tenant_id" TEXT;
ALTER TABLE "orgs" ADD COLUMN IF NOT EXISTS "microsoft_sso_method" TEXT NOT NULL DEFAULT 'oauth';

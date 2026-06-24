-- Per-org module toggles (admin-managed in Settings): agent-studio visibility,
-- AppFlowy Workspace enablement + embed URL. {} = defaults (agent-studio hidden,
-- Workspace off). Additive, idempotent.
ALTER TABLE "org_settings" ADD COLUMN IF NOT EXISTS "app_modules" JSONB NOT NULL DEFAULT '{}';

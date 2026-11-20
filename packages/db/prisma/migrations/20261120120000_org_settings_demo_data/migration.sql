-- Org-level Demo data switch. Off by default so a real org never shows fixture numbers.
ALTER TABLE "org_settings" ADD COLUMN "demo_data" BOOLEAN NOT NULL DEFAULT false;

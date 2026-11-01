-- MARS weekly meeting log as a meeting intel source (additive, feature-flagged off).
-- Enum value is added outside any use in this migration, so it is safe in one transaction (PG 12+).
ALTER TYPE "meeting_intel_source" ADD VALUE IF NOT EXISTS 'mars';

-- Resume cursor for cursor-paged sources (MARS). Null means start from last_sync_at.
ALTER TABLE "meeting_source_connections" ADD COLUMN IF NOT EXISTS "sync_cursor" VARCHAR(500);

-- Source settings (MARS: admin-confirmed account key map, per account cursors for Power BI).
ALTER TABLE "meeting_source_connections" ADD COLUMN IF NOT EXISTS "settings" JSONB;

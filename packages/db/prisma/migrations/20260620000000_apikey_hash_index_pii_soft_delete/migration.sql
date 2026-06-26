-- BidStack 360° — prod-hardening: ApiKey hash index + heavy-PII soft-delete groundwork
--
-- Two concerns, both additive (new index + new nullable columns + indexes):
--   1. P0 hot path — verifyApiKey does findFirst on api_keys.hashed_key on every
--      X-API-Key request. There was no index → full table scan per request.
--   2. CRITICAL GDPR — email_messages / sms_messages / call_sessions hold heavy
--      PII (bodies, recipients, transcripts, recordings) but had no deleted_at,
--      so rows could not be soft-deleted / tombstoned on erasure.
--
-- All statements are idempotent (IF NOT EXISTS) so this is safe to re-run and to
-- apply after the columns/indexes may already exist on a partially-migrated DB.
--
-- NOTE on CONCURRENTLY: CREATE INDEX CONCURRENTLY cannot run inside a transaction
-- block, and Prisma wraps each migration in a transaction — so these use plain
-- CREATE INDEX (brief write lock per table). On a large production table the
-- index builds below SHOULD instead be created out-of-band as:
--   CREATE [UNIQUE] INDEX CONCURRENTLY IF NOT EXISTS <name> ON <table>(<cols>);
-- run manually (outside this migration / outside a tx), then this migration's
-- matching CREATE INDEX IF NOT EXISTS becomes a no-op.

-- ─── 1. ApiKey.hashed_key unique index (verifyApiKey hot path) ───
-- UNIQUE because SHA-256 hex digests of cryptographically-random keys are
-- globally unique by construction; the unique index both backs the lookup and
-- prevents hash collisions. Matches `hashedKey String @unique` in schema.prisma.
-- (If a production DB somehow held duplicate hashes, this would fail — dedupe
-- first, or fall back to a plain CREATE INDEX. None expected here.)
CREATE UNIQUE INDEX IF NOT EXISTS "api_keys_hashed_key_key" ON "api_keys"("hashed_key");

-- ─── 2. Heavy-PII soft-delete columns ───
ALTER TABLE "email_messages" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ(6);
ALTER TABLE "sms_messages"   ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ(6);
ALTER TABLE "call_sessions"  ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ(6);

-- ─── 2b. Composite (org_id, deleted_at) indexes ───
-- Org-scoped soft-delete filtering: WHERE org_id = ? AND deleted_at IS NULL.
CREATE INDEX IF NOT EXISTS "email_messages_org_id_deleted_at_idx" ON "email_messages"("org_id", "deleted_at");
CREATE INDEX IF NOT EXISTS "sms_messages_org_id_deleted_at_idx"   ON "sms_messages"("org_id", "deleted_at");
CREATE INDEX IF NOT EXISTS "call_sessions_org_id_deleted_at_idx"  ON "call_sessions"("org_id", "deleted_at");

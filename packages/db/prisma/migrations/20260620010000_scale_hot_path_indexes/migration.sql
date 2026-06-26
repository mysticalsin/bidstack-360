-- Scale hardening: composite indexes for confirmed hot query paths.
--
-- NOTE for prod: on large tables (audit_log, email_messages especially) build
-- these CONCURRENTLY out-of-band to avoid an ACCESS EXCLUSIVE lock on writes:
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS ... ;
-- Plain CREATE INDEX is used here because CONCURRENTLY cannot run inside the
-- transaction Prisma wraps each migration in (it would error out). These run
-- once at deploy on tables that are still small; the CONCURRENTLY variant is the
-- runbook for tables that have already grown.
-- All statements are idempotent (IF NOT EXISTS) so re-running is a no-op.

-- 1) Audit-log cursor list (routes/audit-logs.ts:175-181).
-- WHERE org_id = ? AND deleted_at IS NULL [AND target_type = ?] [AND at >= ?]
-- ORDER BY id DESC (the keyset cursor). Existing (org_id, at DESC) backs the
-- date-sorted variants; this one backs the actual id-keyset pagination path so
-- the org+soft-delete filter and the id-descending sort are served by one index.
CREATE INDEX IF NOT EXISTS "audit_log_org_deleted_id_idx"
  ON "audit_log"("org_id", "deleted_at", "id" DESC);

-- 2) EmailMessage timeline (routes/integrations/email.ts:61-76).
-- WHERE org_id = ? [AND entity_type = ?] [AND entity_id = ?]
-- ORDER BY sent_at DESC, received_at DESC. The existing (org_id, entity_type,
-- entity_id) index stops at the equality columns; adding sent_at lets the
-- per-entity timeline filter AND sort from a single index.
CREATE INDEX IF NOT EXISTS "email_messages_org_entity_sent_idx"
  ON "email_messages"("org_id", "entity_type", "entity_id", "sent_at" DESC);

-- 3) Curated top-accounts (routes/accounts.ts:149-172).
-- WHERE org_id = ? AND deleted_at IS NULL AND top_account_rank IS NOT NULL
-- ORDER BY top_account_rank ASC. Partial index: the predicate matches the
-- "curated mode" filter exactly, keeping the index tiny (only ranked rows).
CREATE INDEX IF NOT EXISTS "companies_org_top_rank_idx"
  ON "companies"("org_id", "top_account_rank")
  WHERE "top_account_rank" IS NOT NULL;

-- 4) Key-accounts list (routes/accounts.ts:71-93).
-- WHERE org_id = ? AND tier = 'key' AND deleted_at IS NULL
-- ORDER BY name ASC, id ASC. (org_id, tier, name) serves the equality filter
-- plus the primary sort key; id is the PK tiebreaker and is already covered.
CREATE INDEX IF NOT EXISTS "companies_org_tier_name_idx"
  ON "companies"("org_id", "tier", "name");

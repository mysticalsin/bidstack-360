-- Supports the cross-org retention prune in the Yjs compaction worker
-- (DELETE FROM yjs_updates WHERE created_at < cutoff). The existing composite
-- indexes lead with ydoc_id / org_id and cannot serve a created_at-only filter,
-- so the prune previously fell back to a sequential scan.
CREATE INDEX IF NOT EXISTS "yjs_updates_created_at_idx" ON "yjs_updates" ("created_at");

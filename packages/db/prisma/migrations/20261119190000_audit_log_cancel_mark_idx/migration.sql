-- Cancel-mark lookup is (target_id, action), twice per import chunk.
-- Down path: packages/db/prisma/migrations/20261119190000_audit_log_cancel_mark_idx/down.sql

CREATE INDEX IF NOT EXISTS "audit_log_target_action_idx" ON "audit_log" ("target_id", "action");

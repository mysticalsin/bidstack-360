-- Down path for 20261119190000_audit_log_cancel_mark_idx.
-- Prisma migrate deploy does not run this file. Apply it by hand to roll the index back.

DROP INDEX IF EXISTS "audit_log_target_action_idx";

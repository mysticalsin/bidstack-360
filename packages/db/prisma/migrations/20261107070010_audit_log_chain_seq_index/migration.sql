-- Hash-chained audit log, step 2 of 3. Built CONCURRENTLY so audit inserts keep
-- flowing on a large table; it must stay the only statement in this file
-- (CONCURRENTLY cannot run inside a multi-statement transaction).
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "audit_log_org_chain_seq_key" ON "audit_log"("org_id", "chain_seq");

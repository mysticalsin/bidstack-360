-- Append-only, hash-chained audit log, step 1 of 3 (expand only).
-- Nullable columns without defaults: a catalog-only change, no table rewrite.
-- Rows written before the chain triggers exist stay unchained (chain_seq NULL)
-- and are skipped by verification.
ALTER TABLE "audit_log" ADD COLUMN "chain_seq" BIGINT,
ADD COLUMN "prev_hash" VARCHAR(64),
ADD COLUMN "row_hash" VARCHAR(64);

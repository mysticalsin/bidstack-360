-- Hash-chained audit log, step 3 of 3 (expand only). Every insert from any
-- writer (api, worker, mcp-server, raw SQL) is chained by the trigger, so no
-- application code sets the chain columns.
--
-- Rollback without data loss: DROP TRIGGER audit_log_chain / audit_log_append_only
-- / audit_log_no_truncate ON audit_log; the columns can stay (contract step
-- only after sign-off).

-- user_id is excluded from the digest: its FK is ON DELETE SET NULL and GDPR
-- erasure must be able to null it without breaking the chain. The actor is
-- still captured in diff by the writers. deleted_at is excluded for the same
-- reason (soft delete). Fields are encoded as a JSON array so no value can
-- shift a field boundary (unlike a delimiter join).
CREATE OR REPLACE FUNCTION audit_log_row_digest(prev TEXT, r "audit_log")
RETURNS VARCHAR(64)
LANGUAGE sql
STABLE
AS $$
  SELECT encode(
    sha256(
      convert_to(
        jsonb_build_array(
          prev,
          r.org_id::text,
          r.chain_seq::text,
          r.action,
          r.target_type,
          r.target_id,
          r.diff,
          to_char(r.at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
        )::text,
        'UTF8'
      )
    ),
    'hex'
  )
$$;

CREATE OR REPLACE FUNCTION audit_log_chain()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  last_seq BIGINT;
  last_hash VARCHAR(64);
BEGIN
  -- Serialise chain appends per org; released at commit.
  PERFORM pg_advisory_xact_lock(hashtextextended('audit_log_chain:' || NEW.org_id::text, 0));
  SELECT chain_seq, row_hash INTO last_seq, last_hash
    FROM "audit_log"
   WHERE org_id = NEW.org_id AND chain_seq IS NOT NULL
   ORDER BY chain_seq DESC
   LIMIT 1;
  NEW.chain_seq := coalesce(last_seq, 0) + 1;
  NEW.prev_hash := coalesce(last_hash, repeat('0', 64));
  NEW.row_hash := audit_log_row_digest(NEW.prev_hash, NEW);
  RETURN NEW;
END
$$;

CREATE TRIGGER audit_log_chain
BEFORE INSERT ON "audit_log"
FOR EACH ROW EXECUTE FUNCTION audit_log_chain();

-- Content is immutable. Allowed updates: soft delete (deleted_at) and the
-- user FK being nulled (ON DELETE SET NULL / erasure). DELETE stays allowed
-- for org cascade and retention; verification reports any gap it leaves.
CREATE OR REPLACE FUNCTION audit_log_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.org_id IS DISTINCT FROM OLD.org_id
     OR NEW.action IS DISTINCT FROM OLD.action
     OR NEW.target_type IS DISTINCT FROM OLD.target_type
     OR NEW.target_id IS DISTINCT FROM OLD.target_id
     OR NEW.diff IS DISTINCT FROM OLD.diff
     OR NEW.at IS DISTINCT FROM OLD.at
     OR NEW.chain_seq IS DISTINCT FROM OLD.chain_seq
     OR NEW.prev_hash IS DISTINCT FROM OLD.prev_hash
     OR NEW.row_hash IS DISTINCT FROM OLD.row_hash
     OR (NEW.user_id IS DISTINCT FROM OLD.user_id AND NEW.user_id IS NOT NULL) THEN
    RAISE EXCEPTION 'audit_log is append-only: row % cannot be modified', OLD.id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER audit_log_append_only
BEFORE UPDATE ON "audit_log"
FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();

CREATE OR REPLACE FUNCTION audit_log_no_truncate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: TRUNCATE is not allowed'
    USING ERRCODE = 'insufficient_privilege';
END
$$;

CREATE TRIGGER audit_log_no_truncate
BEFORE TRUNCATE ON "audit_log"
FOR EACH STATEMENT EXECUTE FUNCTION audit_log_no_truncate();

-- The application role may read and insert audit rows. It may not delete
-- them. The table owner keeps DELETE for the retention purge and for
-- teardown. This migration does not change the user the API connects as.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_role') THEN
    CREATE ROLE app_role NOLOGIN;
  END IF;
END
$$;

GRANT SELECT, INSERT, UPDATE ON TABLE audit_log TO app_role;
REVOKE DELETE ON TABLE audit_log FROM app_role;

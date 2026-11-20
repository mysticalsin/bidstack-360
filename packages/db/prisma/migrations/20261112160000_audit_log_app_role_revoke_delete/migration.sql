-- Preparatory only. app_role has no members, and the API, worker, and
-- migrate job connect as the table owner, who keeps DELETE. This does not
-- close THREAT-MODEL R-2. SELECT, INSERT, and UPDATE are granted for a later
-- role split, and DELETE is revoked so that split does not inherit delete.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_role') THEN
    CREATE ROLE app_role NOLOGIN;
  END IF;
END
$$;

GRANT SELECT, INSERT, UPDATE ON TABLE audit_log TO app_role;
REVOKE DELETE ON TABLE audit_log FROM app_role;

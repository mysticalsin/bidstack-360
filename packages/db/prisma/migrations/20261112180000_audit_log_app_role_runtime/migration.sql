-- app_role is the login the API, worker, and MCP use. It can read and
-- insert audit rows. It cannot update, delete, or truncate them. The
-- password is set from Key Vault at deploy (BIDSTACK_APP_DB_PASSWORD) and
-- is not stored in this file. The owner login stays on migrations and the
-- retention job, which is the only path that deletes audit rows.
-- Deleting an org still cascades to audit_log through the foreign key.

ALTER ROLE app_role WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT;

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO app_role', current_database());
END
$$;

GRANT USAGE ON SCHEMA public TO app_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_role;
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.audit_log FROM app_role;
GRANT SELECT, INSERT ON TABLE public.audit_log TO app_role;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_role;

// Local Postgres inside the Polo container. The owner login is the initdb
// superuser and stays on migrations and retention. app_role is a different
// login. Its password is the Worker secret POLO_APP_DB_PASSWORD.

export const APP_LOGIN = 'app_role';
export const OWNER_LOGIN = 'bidstack';

export function ownerDatabaseUrl() {
  const url = new URL('postgres://127.0.0.1:5432/bidstack');
  url.username = OWNER_LOGIN;
  url.password = OWNER_LOGIN;
  return url.toString();
}

export function appDatabaseUrl(password) {
  if (!password) throw new Error('POLO_APP_DB_PASSWORD is required');
  const url = new URL(ownerDatabaseUrl());
  url.username = APP_LOGIN;
  url.password = password;
  return url.toString();
}

// A database dump does not contain roles. After restore, the migrations that
// created app_role are already recorded, so they do not run again. The login
// has to exist before pg_restore applies GRANTs and before ALTER ROLE sets
// the password.
export function ensureAppRoleSql() {
  return `DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APP_LOGIN}') THEN
    CREATE ROLE ${APP_LOGIN} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT;
  ELSE
    ALTER ROLE ${APP_LOGIN} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT;
  END IF;
END $$;`;
}

// Same grants as 20261112180000. Reapplied after restore because a dump
// taken without the role skips those GRANTs.
export function appRoleGrantsSql() {
  return `DO $$ BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO ${APP_LOGIN}', current_database());
END $$;
GRANT USAGE ON SCHEMA public TO ${APP_LOGIN};
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_LOGIN};
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.audit_log FROM ${APP_LOGIN};
GRANT SELECT, INSERT ON TABLE public.audit_log TO ${APP_LOGIN};
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${APP_LOGIN};
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${APP_LOGIN};
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${APP_LOGIN};`;
}

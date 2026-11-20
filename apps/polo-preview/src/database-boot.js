import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';

// app_role is a cluster role. snapshotFile() dumps one database, so a restore
// onto a fresh initdb cluster does not recreate it. _prisma_migrations still
// lists the role migrations, and migrate deploy will not create it again.
// The role is created before restore and tightened again after migrate,
// because a recorded migration must not be the last writer of its grants.
// Least privilege, and safe to repeat.

export const APP_ROLE_CONNECTION_LIMIT = 100;

const ROLE_ATTRIBUTES =
  'LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT CONNECTION LIMIT ' +
  APP_ROLE_CONNECTION_LIMIT;

export const ENSURE_APP_ROLE_SQL = `
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_role') THEN
    CREATE ROLE app_role WITH ${ROLE_ATTRIBUTES};
  ELSE
    ALTER ROLE app_role WITH ${ROLE_ATTRIBUTES};
  END IF;
END
$$;

DO $$
DECLARE
  granted text;
BEGIN
  FOR granted IN
    SELECT r.rolname
    FROM pg_auth_members m
    JOIN pg_roles r ON r.oid = m.roleid
    JOIN pg_roles member ON member.oid = m.member
    WHERE member.rolname = 'app_role'
  LOOP
    EXECUTE format('REVOKE %I FROM app_role', granted);
  END LOOP;
END
$$;
`;

// Owner-side, idempotent. pg_restore uses --no-privileges, so the dump's
// ACLs are not the authority. A migration that already ran is not either.
export const APP_ROLE_LOCK_SQL = `
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO app_role', current_database());
END
$$;
GRANT USAGE ON SCHEMA public TO app_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_role;
REVOKE ALL ON TABLE public.audit_log FROM PUBLIC, app_role;
GRANT SELECT, INSERT ON TABLE public.audit_log TO app_role;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public._prisma_migrations FROM app_role;
`;

export const APP_ROLE_GATE_SQL = `
SELECT CASE
  WHEN NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_role') THEN 'missing app_role'
  WHEN NOT (
    SELECT rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
      AND NOT rolreplication AND NOT rolbypassrls AND NOT rolinherit
      AND rolconnlimit = ${APP_ROLE_CONNECTION_LIMIT}
    FROM pg_roles WHERE rolname = 'app_role'
  ) THEN 'app_role attributes'
  WHEN EXISTS (
    SELECT 1 FROM pg_auth_members m
    JOIN pg_roles member ON member.oid = m.member
    WHERE member.rolname = 'app_role'
  ) THEN 'app_role membership'
  WHEN has_table_privilege('app_role', 'public.audit_log', 'UPDATE')
    OR has_table_privilege('app_role', 'public.audit_log', 'DELETE')
    OR has_table_privilege('app_role', 'public.audit_log', 'TRUNCATE')
    OR NOT has_table_privilege('app_role', 'public.audit_log', 'SELECT')
    OR NOT has_table_privilege('app_role', 'public.audit_log', 'INSERT')
    THEN 'audit_log privileges'
  WHEN has_schema_privilege('app_role', 'public', 'CREATE') THEN 'app_role can create in public'
  WHEN EXISTS (
    SELECT 1
    FROM pg_namespace n
    CROSS JOIN LATERAL aclexplode(COALESCE(n.nspacl, acldefault('n', n.nspowner))) a
    WHERE n.nspname = 'public' AND a.grantee = 0 AND a.privilege_type = 'CREATE'
  ) THEN 'public can create in public'
  WHEN EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner WHERE r.rolname = 'app_role'
    UNION ALL
    SELECT 1 FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner WHERE r.rolname = 'app_role'
    UNION ALL
    SELECT 1 FROM pg_namespace n JOIN pg_roles r ON r.oid = n.nspowner WHERE r.rolname = 'app_role'
  ) THEN 'app_role owns an object'
  WHEN EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.audit_log'::regclass
      AND NOT tgisinternal
      AND tgname IN ('audit_log_chain', 'audit_log_append_only', 'audit_log_no_truncate')
      AND tgenabled = 'D'
  ) THEN (
    SELECT 'audit trigger disabled: ' || tgname
    FROM pg_trigger
    WHERE tgrelid = 'public.audit_log'::regclass
      AND NOT tgisinternal
      AND tgname IN ('audit_log_chain', 'audit_log_append_only', 'audit_log_no_truncate')
      AND tgenabled = 'D'
    LIMIT 1
  )
  WHEN (
    SELECT count(*) FROM pg_trigger
    WHERE tgrelid = 'public.audit_log'::regclass
      AND NOT tgisinternal
      AND tgname IN ('audit_log_chain', 'audit_log_append_only', 'audit_log_no_truncate')
  ) < 3 THEN 'audit trigger disabled'
  WHEN has_table_privilege('app_role', 'public._prisma_migrations', 'INSERT')
    OR has_table_privilege('app_role', 'public._prisma_migrations', 'UPDATE')
    OR has_table_privilege('app_role', 'public._prisma_migrations', 'DELETE')
    OR has_table_privilege('app_role', 'public._prisma_migrations', 'TRUNCATE')
    THEN 'prisma migrations dml'
  ELSE 'ok'
END;
`;

// createdb already made schema public. This is the only pg_restore line that
// is not data loss. A longer line that merely contains the phrase is not it.
export const HARMLESS_RESTORE_ERROR_LINE =
  'pg_restore: error: could not execute query: ERROR:  schema "public" already exists';

function lines(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function isHarmlessRestoreError(line) {
  return line === HARMLESS_RESTORE_ERROR_LINE;
}

export function restoreErrorsThatMatter(text) {
  return lines(text).filter((line) => /^pg_restore: error:/i.test(line) && !isHarmlessRestoreError(line));
}

// Null means the restore can proceed. Any other non-zero exit, or an error
// line that is not the one public-schema notice, must fail the boot.
export function restoreFailure(status, text) {
  const matter = restoreErrorsThatMatter(text);
  if (matter.length === 0 && status === 0) return null;
  const errors = lines(text).filter((line) => /^pg_restore: error:/i.test(line));
  const duplicateSchema = (String(text || '').match(/\b42P06\b/g) || []).length;
  if (duplicateSchema > 1) return `pg_restore failed (${status ?? 'error'}): SQLSTATE 42P06 repeated`;
  if (matter.length === 0 && errors.length === 1 && errors.every(isHarmlessRestoreError)) return null;
  const sample = (matter.length > 0 ? matter : lines(text)).slice(0, 5).join(' | ').slice(0, 500);
  return `pg_restore failed (${status ?? 'error'})${sample ? `: ${sample}` : ''}`;
}

// A failed ALTER ROLE must not keep the statement. psql verbose prints
// `ERROR:  42601: ...`; only that SQLSTATE is safe to record.
export function appRolePasswordError(stderr) {
  const match = /ERROR:\s+([0-9A-Z]{5})\b/.exec(String(stderr || ''));
  return `could not set the app role password (${match?.[1] || 'unknown'})`;
}

// PostgreSQL stores SCRAM-SHA-256 as iterations, salt, StoredKey, ServerKey.
// The server never sees the cleartext password.
export function scramSha256Verifier(password) {
  const iterations = 4096;
  const salt = randomBytes(16);
  const salted = pbkdf2Sync(String(password), salt, iterations, 32, 'sha256');
  const clientKey = createHmac('sha256', salted).update('Client Key').digest();
  const storedKey = createHash('sha256').update(clientKey).digest();
  const serverKey = createHmac('sha256', salted).update('Server Key').digest();
  return `SCRAM-SHA-256$${iterations}:${salt.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`;
}

export function alterRolePasswordSql(role, verifier) {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(role)) throw new Error('app role name is not safe');
  if (!/^SCRAM-SHA-256\$\d+:[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/.test(verifier)) {
    throw new Error('app role verifier is not a SCRAM secret');
  }
  return `ALTER ROLE ${role} PASSWORD '${verifier}';\n`;
}

export function scrubChildEnv(env) {
  const next = { ...env };
  delete next.POLO_APP_DB_PASSWORD;
  delete next.POLO_INTERNAL_KEY;
  return next;
}

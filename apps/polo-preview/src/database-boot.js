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
      AND tgenabled NOT IN ('O', 'A')
  ) THEN (
    SELECT 'audit trigger disabled: ' || tgname
    FROM pg_trigger
    WHERE tgrelid = 'public.audit_log'::regclass
      AND NOT tgisinternal
      AND tgname IN ('audit_log_chain', 'audit_log_append_only', 'audit_log_no_truncate')
      AND tgenabled NOT IN ('O', 'A')
    LIMIT 1
  )
  WHEN (
    SELECT count(*) FROM pg_trigger
    WHERE tgrelid = 'public.audit_log'::regclass
      AND NOT tgisinternal
      AND tgname IN ('audit_log_chain', 'audit_log_append_only', 'audit_log_no_truncate')
      AND tgenabled IN ('O', 'A')
  ) < 3 THEN 'audit trigger disabled'
  WHEN has_table_privilege('app_role', 'public._prisma_migrations', 'INSERT')
    OR has_table_privilege('app_role', 'public._prisma_migrations', 'UPDATE')
    OR has_table_privilege('app_role', 'public._prisma_migrations', 'DELETE')
    OR has_table_privilege('app_role', 'public._prisma_migrations', 'TRUNCATE')
    THEN 'prisma migrations dml'
  ELSE 'ok'
END;
`;

function lines(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

// PGVERBOSITY=verbose and LC_ALL=C make pg_restore print this once when
// createdb already made schema public. The SQLSTATE alone is any duplicate
// schema. Any other error, or a zero exit that still printed it, fails the boot.
export const DUPLICATE_PUBLIC_SCHEMA = 'ERROR:  42P06: schema "public" already exists';

export function restoreFailure(status, text) {
  const body = String(text || '');
  const marks = body.split(DUPLICATE_PUBLIC_SCHEMA).length - 1;
  const errors = lines(body).filter((line) => /^pg_restore: error:/i.test(line));
  if (status === 0 && errors.length === 0 && marks === 0) return null;
  if (
    status === 1 &&
    marks === 1 &&
    errors.length > 0 &&
    errors.every((line) => line.includes(DUPLICATE_PUBLIC_SCHEMA))
  ) {
    return null;
  }
  const sample = (errors.length > 0 ? errors : lines(body)).slice(0, 5).join(' | ').slice(0, 500);
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
  // panic is above ERROR, so a failed ALTER is not written to the server log.
  return `SET log_statement = 'none';\nSET log_min_error_statement = 'panic';\nALTER ROLE ${role} PASSWORD '${verifier}';\n`;
}

export function scrubChildEnv(env) {
  const next = { ...env };
  delete next.POLO_APP_DB_PASSWORD;
  delete next.POLO_INTERNAL_KEY;
  return next;
}

// LC_ALL=C keeps psql's error text stable. psql 16 does not print a SQLSTATE
// from PGVERBOSITY; the argv has to pass -v VERBOSITY=verbose. The caller
// still scrubs the secret, and the verifier stays on stdin.
/**
 * @param {Record<string, string>} [extra]
 * @returns {Record<string, string>}
 */
export function passwordPsqlEnv(extra = {}) {
  return { ...extra, LC_ALL: 'C', LANG: 'C', PGVERBOSITY: 'verbose' };
}

// -c would put the ALTER text, including the SCRAM verifier, on argv.
export function assertPsqlArgsHaveNoCommand(args) {
  if (!Array.isArray(args)) throw new Error('psql argv must be a list');
  const list = args.map((arg) => String(arg));
  for (const arg of list) {
    if (arg === '-c' || arg === '--command' || arg.startsWith('--command=')) {
      throw new Error('psql argv must not use -c');
    }
  }
  return list;
}

export const BOOT_STATES = Object.freeze({
  Init: 'Init',
  AppRoleRestore: 'AppRoleRestore',
  TolerateDuplicateSchema: 'TolerateDuplicateSchema',
  DrillHooks: 'DrillHooks',
  Ready: 'Ready',
  Failed: 'Failed',
});

const TERMINAL_BOOT_STATES = new Set([BOOT_STATES.Ready, BOOT_STATES.Failed]);

function blank(value) {
  return String(value ?? '').trim();
}

function asEnv(env) {
  return env && typeof env === 'object' ? env : {};
}

export function drillHooksAllowed(env) {
  const source = asEnv(env);
  return (
    source.POLO_RESTORE_DRILL === '1' &&
    String(source.NODE_ENV || '').toLowerCase() !== 'production'
  );
}

function drillHooksRequested(env) {
  const source = asEnv(env);
  const gate = source.POLO_GATE_BREAK || '';
  const knownGate = gate === 'audit-trigger' || gate === 'audit-trigger-replica';
  return (
    knownGate || source.POLO_DROP_APP_ROLE === '1' || Boolean(source.POLO_PASSWORD_TARGET_ROLE)
  );
}

export function selectDrillHooks(env) {
  const source = asEnv(env);
  if (!drillHooksAllowed(source)) {
    return { allowed: false, dropAppRole: false, gateBreak: '', passwordRole: 'app_role' };
  }
  const raw = source.POLO_PASSWORD_TARGET_ROLE || '';
  if (raw && !/^[a-z_][a-z0-9_]{0,62}$/.test(raw)) {
    throw new Error('POLO_PASSWORD_TARGET_ROLE is not a role name');
  }
  return {
    allowed: true,
    dropAppRole: source.POLO_DROP_APP_ROLE === '1',
    gateBreak: source.POLO_GATE_BREAK || '',
    passwordRole: raw || 'app_role',
  };
}

export function classifyBootFailure(error) {
  const message = blank(
    error && typeof error === 'object' && 'message' in error ? error.message : error,
  );
  const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
  if (code === 'ETIMEDOUT' || /timed out|\btimeout\b/i.test(message)) {
    return { infrastructure: true, reason: `infrastructure: ${message || 'timeout'}` };
  }
  return { infrastructure: false, reason: message };
}

function transitionRecord(from, event, to, guard, reason, infrastructure) {
  return { from, event, to, guard, reason, infrastructure: Boolean(infrastructure) };
}

// The container boot used to be a row of conditionals. This is that same
// sequence: init, app-role restore, one public-schema notice, drill hooks,
// then Ready or Failed. A false guard ends in Failed, except a drill hook
// that production must ignore, which stays in DrillHooks.
export function createDatabaseBoot({ log } = {}) {
  const transitions = [];
  let state = BOOT_STATES.Init;
  let reason = '';

  function emit(entry) {
    transitions.push(entry);
    if (typeof log === 'function') log(entry);
    return entry;
  }

  function fail(from, event, why) {
    state = BOOT_STATES.Failed;
    reason = why;
    return emit(transitionRecord(from, event, state, false, why, false));
  }

  function move(from, event, to, why, infrastructure = false) {
    state = to;
    if (to === BOOT_STATES.Ready || to === BOOT_STATES.Failed || why) reason = why;
    return emit(transitionRecord(from, event, to, true, why || '', infrastructure));
  }

  function send(event) {
    const name =
      event && typeof event === 'object' && typeof event.type === 'string' ? event.type : 'unknown';
    const from = state;
    if (TERMINAL_BOOT_STATES.has(from)) {
      return emit(transitionRecord(from, name, from, false, 'terminal', false));
    }

    if (from === BOOT_STATES.Init && name === 'cluster-ready') {
      if (!event || event.ready !== true) return fail(from, name, 'cluster is not ready');
      return move(from, name, BOOT_STATES.AppRoleRestore, '');
    }

    if (from === BOOT_STATES.Init && name === 'init-failed') {
      const why = blank(event && event.reason);
      if (!why) return fail(from, name, 'init failed without a reason');
      return move(from, name, BOOT_STATES.Failed, why);
    }

    if (from === BOOT_STATES.AppRoleRestore && name === 'restore-result') {
      const status = event ? event.status : undefined;
      if (!(typeof status === 'number' || status === null)) {
        return fail(from, name, 'restore result is not classifiable');
      }
      move(from, name, BOOT_STATES.TolerateDuplicateSchema, '');
      const failure = restoreFailure(status, event.text);
      if (failure) return fail(BOOT_STATES.TolerateDuplicateSchema, name, failure);
      const why = status === 1 ? 'duplicate public schema once' : 'clean restore';
      return move(BOOT_STATES.TolerateDuplicateSchema, name, BOOT_STATES.DrillHooks, why);
    }

    if (from === BOOT_STATES.AppRoleRestore && name === 'skip-restore') {
      if (!event || event.how !== 'seed')
        return fail(from, name, 'skip-restore is only for a seed boot');
      return move(from, name, BOOT_STATES.DrillHooks, 'seed');
    }

    if (from === BOOT_STATES.DrillHooks && name === 'apply-drill-hooks') {
      let hooks;
      try {
        hooks = selectDrillHooks(event && event.env);
      } catch (error) {
        return fail(from, name, error instanceof Error ? error.message : String(error));
      }
      const requested = drillHooksRequested(event && event.env);
      if (requested && !hooks.allowed) {
        return emit(transitionRecord(from, name, from, false, 'drill hooks refused', false));
      }
      return emit(
        transitionRecord(
          from,
          name,
          from,
          true,
          requested ? 'drill hooks applied' : 'no drill hooks',
          false,
        ),
      );
    }

    if (from === BOOT_STATES.DrillHooks && name === 'gate-passed') {
      const how = event && (event.how === 'restore' || event.how === 'seed') ? event.how : '';
      if (!how) return fail(from, name, 'ready needs a restore or a seed');
      return move(from, name, BOOT_STATES.Ready, how);
    }

    if (name === 'gate-failed' || name === 'boot-failed') {
      const classified = classifyBootFailure(event && (event.error || event.reason));
      if (classified.infrastructure)
        return move(from, name, BOOT_STATES.Failed, classified.reason, true);
      const why = blank(event && event.reason) || classified.reason;
      if (!why) return fail(from, name, 'boot failed without a reason');
      return move(from, name, BOOT_STATES.Failed, why);
    }

    return fail(from, name, `illegal transition ${from} ${name}`);
  }

  return {
    get state() {
      return state;
    },
    get reason() {
      return reason;
    },
    get terminal() {
      return TERMINAL_BOOT_STATES.has(state);
    },
    get transitions() {
      return transitions.slice();
    },
    send,
  };
}

// WHY: a database dump cannot recreate app_role. The boot has to create that
// login before pg_restore applies grants, and a restore error that is not the
// existing public schema has to fail the boot instead of being ignored.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ENSURE_APP_ROLE_SQL, restoreFailure } from './database-boot.js';

const entry = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../container/entrypoint.mjs'), 'utf8');

function functionBody(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  const next = source.indexOf('\nfunction ', start + 1);
  return source.slice(start, next === -1 ? undefined : next);
}

describe('polo app role boot', () => {
  it('creates a least-privilege login that is safe to run again', () => {
    expect(ENSURE_APP_ROLE_SQL).toMatch(/IF NOT EXISTS/);
    expect(ENSURE_APP_ROLE_SQL).toMatch(/CREATE ROLE app_role WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT/);
    expect(ENSURE_APP_ROLE_SQL).toMatch(/ALTER ROLE app_role WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT/);
    // WHY: NOSUPERUSER is the server default, so the drill still passes if
    // the word is deleted. The source has to name it.
    expect(ENSURE_APP_ROLE_SQL).toMatch(/\bNOSUPERUSER\b/);
    expect(ENSURE_APP_ROLE_SQL).not.toMatch(/\bSUPERUSER\b/);
    expect(ENSURE_APP_ROLE_SQL).not.toMatch(/PASSWORD/i);
  });

  it('fails a restore on errors that matter and lets the public schema notice pass', () => {
    const tolerated = 'pg_restore: error: could not execute query: ERROR:  schema "public" already exists';
    expect(restoreFailure(0, '')).toBeNull();
    expect(restoreFailure(1, tolerated)).toBeNull();

    const missing = restoreFailure(1, 'pg_restore: error: could not execute query: ERROR:  role "app_role" does not exist');
    expect(missing).toMatch(/^pg_restore failed/);
    expect(missing).toMatch(/role "app_role" does not exist/);

    const junk = restoreFailure(1, 'pg_restore: error: input file does not appear to be a valid archive');
    expect(junk).toMatch(/^pg_restore failed/);
    expect(junk).toMatch(/valid archive/);
  });

  it('rejects a public-schema notice that also carries another failure', () => {
    const tolerated = 'pg_restore: error: could not execute query: ERROR:  schema "public" already exists';
    // WHY: a substring match treats this whole line as the notice.
    const mixed = `${tolerated}; permission denied for table audit_log`;
    expect(restoreFailure(1, mixed)).not.toBeNull();
    expect(restoreFailure(1, mixed)).toMatch(/permission denied/);
  });

  it('rejects some other object already existing', () => {
    // WHY: a matcher widened to /already exists/ would hide this line.
    const other = restoreFailure(1, 'pg_restore: error: could not execute query: ERROR:  relation "audit_log" already exists');
    expect(other).not.toBeNull();
    expect(other).toMatch(/relation "audit_log" already exists/);
  });

  it('creates the role before restore and before migrate, and checks pg_restore', () => {
    const migrate = functionBody(entry, 'migrate');
    const restore = functionBody(entry, 'restoreFrom');
    const deploy = migrate.indexOf("['migrate', 'deploy'");
    const password = migrate.indexOf('setAppRolePassword()');
    const dump = restore.indexOf("'pg_restore'");
    const ensureMigrate = migrate.indexOf('ensureAppRole()');
    const ensureRestore = restore.indexOf('ensureAppRole()');
    const reported = restore.indexOf('restoreFailure(');

    // WHY: a missing call is -1, and -1 < dump would still pass. Presence
    // has to be asserted before order. Grants in the dump fail if the role
    // is created afterwards, and a fresh boot never reaches ALTER ROLE
    // PASSWORD if migrate runs first on a cluster that does not have the role.
    expect(ensureMigrate).toBeGreaterThan(-1);
    expect(deploy).toBeGreaterThan(-1);
    expect(password).toBeGreaterThan(-1);
    expect(ensureMigrate).toBeLessThan(deploy);
    expect(password).toBeGreaterThan(deploy);
    expect(ensureRestore).toBeGreaterThan(-1);
    expect(dump).toBeGreaterThan(-1);
    expect(reported).toBeGreaterThan(-1);
    expect(ensureRestore).toBeLessThan(dump);
    expect(reported).toBeGreaterThan(dump);
  });

  it('keeps the production paths and ports when the drill does not override them', () => {
    expect(entry).toContain("process.env.POLO_APP_ROOT || '/app'");
    expect(entry).toContain("process.env.POLO_DATA_DIR || '/data'");
    expect(entry).toContain("configuredPort('POLO_HTTP_PORT', 8080)");
    expect(entry).toContain("configuredPort('POLO_API_PORT', 4020)");
    expect(entry).toContain("configuredPort('POLO_PG_PORT', 5432)");
    expect(entry).toContain("configuredPort('POLO_REDIS_PORT', 6379)");
    expect(entry).toContain('process.env.POLO_REDIS_HOST');
    expect(entry).toContain("process.env.POLO_MIGRATE_STAGING || '/tmp/polo-migrate'");
    expect(entry).toContain("process.env.POLO_SNAPSHOT_DIR || '/tmp/snapshot'");
    expect(entry).toContain("process.env.POLO_SNAPSHOT_TGZ || '/tmp/snapshot.tgz'");
    expect(entry).toContain("process.env.POLO_RESTORE_DIR || '/tmp/restore'");
  });

  it('binds the app role password and records only the SQLSTATE when that fails', () => {
    const body = functionBody(entry, 'setAppRolePassword');
    // WHY: splicing the secret into the statement puts it in argv, logs, and
    // a failed ALTER's error text. psql :'var' quotes a bound value.
    expect(body).toContain(":'app_db_password'");
    expect(body).not.toMatch(/\$\{/);
    expect(body).not.toContain('quoteLiteral');
    expect(body).toContain('appRolePasswordError(');
    expect(body).not.toContain('remember(');
  });
});

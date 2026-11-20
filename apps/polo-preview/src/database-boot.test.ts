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
    expect(ENSURE_APP_ROLE_SQL).not.toMatch(/\bSUPERUSER\b/);
    expect(ENSURE_APP_ROLE_SQL).not.toMatch(/PASSWORD/i);
  });

  it('fails a restore on errors that matter and lets the public schema notice pass', () => {
    expect(restoreFailure(0, '')).toBeNull();
    expect(restoreFailure(1, 'pg_restore: error: could not execute query: ERROR:  schema "public" already exists')).toBeNull();

    const missing = restoreFailure(1, 'pg_restore: error: could not execute query: ERROR:  role "app_role" does not exist');
    expect(missing).toMatch(/^pg_restore failed/);
    expect(missing).toMatch(/role "app_role" does not exist/);

    const junk = restoreFailure(1, 'pg_restore: error: input file does not appear to be a valid archive');
    expect(junk).toMatch(/^pg_restore failed/);
    expect(junk).toMatch(/valid archive/);
  });

  it('creates the role before restore and before migrate, and checks pg_restore', () => {
    const migrate = functionBody(entry, 'migrate');
    const restore = functionBody(entry, 'restoreFrom');
    const deploy = migrate.indexOf("['migrate', 'deploy'");
    const dump = restore.indexOf("'pg_restore'");

    // WHY: grants in the dump fail if the role is created afterwards, and a
    // fresh boot never reaches ALTER ROLE PASSWORD if migrate runs first on
    // a cluster that does not have the role yet.
    expect(migrate.indexOf('ensureAppRole()')).toBeGreaterThan(-1);
    expect(migrate.indexOf('ensureAppRole()')).toBeLessThan(deploy);
    expect(migrate.indexOf('setAppRolePassword()')).toBeGreaterThan(deploy);
    expect(restore.indexOf('ensureAppRole()')).toBeLessThan(dump);
    expect(restore.indexOf('restoreFailure(')).toBeGreaterThan(dump);
  });
});

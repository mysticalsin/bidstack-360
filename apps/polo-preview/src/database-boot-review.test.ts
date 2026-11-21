// WHY: Inspector and Sentinel rejected the first review of the database boot.
// Each case below fails on the code they named, before that case is fixed.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { containerEnv } from './container-env.js';
import * as databaseBoot from './database-boot.js';

const here = dirname(fileURLToPath(import.meta.url));
const entry = readFileSync(join(here, '../container/entrypoint.mjs'), 'utf8');

function functionBody(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  const next = source.indexOf('\nfunction ', start + 1);
  return source.slice(start, next === -1 ? undefined : next);
}

function callBody(source: string, openParen: number): string {
  let depth = 0;
  for (let i = openParen; i < source.length; i += 1) {
    if (source[i] === '(') depth += 1;
    else if (source[i] === ')') {
      depth -= 1;
      if (depth === 0) return source.slice(openParen, i + 1);
    }
  }
  return source.slice(openParen);
}

describe('database boot review', () => {
  it('passes -v VERBOSITY=verbose on the password psql argv', () => {
    // WHY: PGVERBOSITY in the environment does not make psql 16 print the
    // SQLSTATE. The child has to receive -v VERBOSITY=verbose, and that argv
    // must still not carry the password or the SCRAM verifier.
    const body = functionBody(entry, 'setAppRolePassword');
    const spawnAt = body.indexOf('spawnSync');
    const spawn = callBody(body, body.indexOf('(', spawnAt));
    const secret = "fix'ture\\pass";
    expect(spawn).toContain('VERBOSITY=verbose');
    expect(spawn).toContain("'-v'");
    expect(spawn).not.toContain(secret);
    expect(spawn).not.toContain('SCRAM-SHA-256$');
    expect(spawn).not.toMatch(/['"]-c['"]/);
  });

  it('refuses Ready until the app role gate is verified', () => {
    // WHY: gate-passed alone reached Ready, so deleting assertAppRoleGate()
    // still left every unit test green and a disabled trigger could boot.
    if (typeof databaseBoot.createDatabaseBoot !== 'function') {
      throw new Error('createDatabaseBoot is not exported');
    }
    const boot = databaseBoot.createDatabaseBoot();
    boot.send({ type: 'cluster-ready', ready: true });
    boot.send({ type: 'skip-restore', how: 'seed' });
    boot.send({ type: 'gate-passed', how: 'seed' });
    expect(boot.state).toBe('Failed');
    expect(boot.reason).toMatch(/app role gate was not verified/);

    const disabled = databaseBoot.createDatabaseBoot();
    disabled.send({ type: 'cluster-ready', ready: true });
    disabled.send({ type: 'skip-restore', how: 'seed' });
    disabled.send({
      type: 'app-role-gate',
      verdict: 'audit trigger disabled: audit_log_append_only',
    });
    expect(disabled.state).toBe('Failed');
    expect(disabled.reason).toMatch(/audit_log_append_only/);
    expect(disabled.state).not.toBe('Ready');

    const finish = functionBody(entry, 'finishBoot');
    const gate = functionBody(entry, 'assertAppRoleGate');
    expect(finish).toContain('assertAppRoleGate()');
    expect(finish.indexOf('assertAppRoleGate()')).toBeLessThan(
      finish.indexOf("type: 'gate-passed'"),
    );
    expect(gate).toContain("type: 'app-role-gate'");
    expect(finish).toMatch(/to !== 'Ready'/);
  });

  it('refuses drill hooks when the production deployment marker is set', () => {
    // WHY: the supervisor has no NODE_ENV, so a NODE_ENV check never fires in
    // the container. Path overrides were still gated by the flag alone.
    expect(
      databaseBoot.drillHooksAllowed({
        POLO_RESTORE_DRILL: '1',
        POLO_DEPLOYMENT: 'production',
      }),
    ).toBe(false);
    expect(databaseBoot.drillHooksAllowed({ POLO_RESTORE_DRILL: '1' })).toBe(true);
    const secrets = {
      POLO_INTERNAL_KEY: 'k',
      POLO_INTEGRATION_TOKEN_KEY: 'a'.repeat(64),
      POLO_PII_ENCRYPTION_MASTER_KEY: 'b'.repeat(64),
      POLO_JOB_SIGNING_SECRET: 's',
      POLO_APP_DB_PASSWORD: 'fixture-password',
    };
    expect(containerEnv({ ...secrets, ALLOWED_EMAILS: 'a@x.com' }).POLO_DEPLOYMENT).toBe(
      'production',
    );
    for (const name of ['overrideInDrill', 'startDatabase']) {
      expect(functionBody(entry, name)).toContain('drillHooksAllowed(');
    }
    const secret = "fix'ture\\pass";
    const escaped = secret.replaceAll("'", "''");
    expect(escaped).not.toContain(secret);
    expect(databaseBoot.secretLeakKind(`note ${escaped}`, secret)).toBe('plaintext');
    expect(databaseBoot.secretLeakKind(`note ${secret}`, secret)).toBe('plaintext');
    expect(databaseBoot.secretLeakKind('SCRAM-SHA-256$abc', secret)).toBe('verifier');
    expect(databaseBoot.secretLeakKind('clean log', secret)).toBe('clean');
  });

  it('rejects a public schema notice that has trailing text on the same line', () => {
    // WHY: includes() treats the sentence plus another failure as the one
    // tolerated notice. The line has to be exactly that pg_restore error.
    const exact =
      'pg_restore: error: could not execute query: ERROR:  42P06: schema "public" already exists';
    const trailed = `${exact}; permission denied for table audit_log`;
    expect(databaseBoot.restoreFailure(1, exact)).toBeNull();
    expect(databaseBoot.restoreFailure(1, trailed)).not.toBeNull();
    expect(databaseBoot.restoreFailure(1, trailed)).toMatch(/permission denied/);
  });

  it('tolerates the real psql 16 verbose public-schema notice', () => {
    // WHY: PostgreSQL 16.15 libpq with PQERRORS_VERBOSE (what psql -v
    // VERBOSITY=verbose and a verbose pg_restore print) puts the SQLSTATE on
    // the error line and LOCATION on the next line. That next line must not
    // hide the one tolerated notice or widen it.
    // Captured from PQerrorMessage after CREATE SCHEMA public on 16.15:
    //   ERROR:  42P06: schema "public" already exists
    //   LOCATION:  NamespaceCreate, pg_namespace.c:62
    // pg_restore prefixes the first line and then prints "Command was:".
    const verbose = [
      'pg_restore: error: could not execute query: ERROR:  42P06: schema "public" already exists',
      'LOCATION:  NamespaceCreate, pg_namespace.c:62',
      'Command was: CREATE SCHEMA public;',
    ].join('\n');
    expect(verbose).toContain('ERROR:  42P06: schema "public" already exists');
    expect(databaseBoot.restoreFailure(1, verbose)).toBeNull();
    const glued = verbose.replace(
      'already exists\nLOCATION:',
      'already exists LOCATION:',
    );
    expect(databaseBoot.restoreFailure(1, glued)).not.toBeNull();
  });

  it('rejects bundled and prefixed psql command options', () => {
    // WHY: -c is not the only way to put SQL on argv. -cSQL, a cluster such
    // as -Atc, and a long-option prefix such as --comm do the same.
    const reject = (args: string[]) => databaseBoot.assertPsqlArgsHaveNoCommand(args);
    expect(() => reject(['-cSELECT 1'])).toThrow(/-c/);
    expect(() => reject(['-Atc', 'select 1'])).toThrow(/-c/);
    expect(() => reject(['-qc', 'select 1'])).toThrow(/-c/);
    expect(() => reject(['--comm', 'select 1'])).toThrow(/-c/);
    expect(() => reject(['--comma=select 1'])).toThrow(/-c/);
    expect(reject(['-d', 'bidstack', '-v', 'VERBOSITY=verbose', '-q'])).toEqual([
      '-d',
      'bidstack',
      '-v',
      'VERBOSITY=verbose',
      '-q',
    ]);
  });
});

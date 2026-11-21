// WHY: PR #353 left four follow-ups on the database boot. The public-schema
// notice has to be the full sentence, the password psql has to print a
// SQLSTATE, that psql's argv must not carry -c, and a production environment
// must not run the drill hooks.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as databaseBoot from './database-boot.js';

const here = dirname(fileURLToPath(import.meta.url));
const entry = readFileSync(join(here, '../container/entrypoint.mjs'), 'utf8');
const self = readFileSync(fileURLToPath(import.meta.url), 'utf8');

const FULL = 'ERROR:  42P06: schema "public" already exists';
const PUBLIC_NOTICE = `pg_restore: error: could not execute query: ${FULL}`;

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

function spawnCall(name: string): string {
  const body = functionBody(entry, name);
  const spawnAt = body.indexOf('spawnSync');
  return callBody(body, body.indexOf('(', spawnAt));
}

function assignsDrillFlag(source: string): boolean {
  const withoutComparisons = source.replace(/POLO_RESTORE_DRILL\s*(?:===|!==|==|!=)/g, 'COMPARED');
  if (/POLO_RESTORE_DRILL\s*=/.test(withoutComparisons)) return true;
  return /POLO_RESTORE_DRILL\s*:\s*['"]1['"]/.test(source);
}

describe('database boot follow-ups', () => {
  it('does not skip or mark a case expected to fail', () => {
    const banned = [`.${'skip'}(`, `x${'it'}(`, `x${'test'}(`, `x${'describe'}(`, `x${'fail'}`];
    for (const part of banned) expect(self.includes(part)).toBe(false);
  });

  it('pins the full 42P06 public schema text', () => {
    // WHY: SQLSTATE 42P06 is any duplicate schema. Only schema public, which
    // createdb already made, is the one notice a fresh cluster is allowed to print.
    const other =
      'pg_restore: error: could not execute query: ERROR:  42P06: schema "audit" already exists';
    const prefix = 'pg_restore: error: could not execute query: ERROR:  42P06:';
    const oneSpace =
      'pg_restore: error: could not execute query: ERROR: 42P06: schema "public" already exists';
    const publicExtra =
      'pg_restore: error: could not execute query: ERROR:  42P06: schema "public_extra" already exists';
    // A SQLSTATE-only match still accepts schema audit. The full sentence does not.
    expect(databaseBoot.restoreFailure(1, other)).not.toBeNull();
    expect(databaseBoot.restoreFailure(1, prefix)).not.toBeNull();
    expect(databaseBoot.restoreFailure(1, oneSpace)).not.toBeNull();
    expect(databaseBoot.restoreFailure(1, publicExtra)).not.toBeNull();
    expect(databaseBoot.DUPLICATE_PUBLIC_SCHEMA).toBe(FULL);
    expect(databaseBoot.restoreFailure(1, PUBLIC_NOTICE)).toBeNull();
    expect(databaseBoot.restoreFailure(0, PUBLIC_NOTICE)).not.toBeNull();
    expect(databaseBoot.restoreFailure(1, `${PUBLIC_NOTICE}\n${PUBLIC_NOTICE}`)).not.toBeNull();
    expect(databaseBoot.restoreFailure(2, PUBLIC_NOTICE)).not.toBeNull();
  });

  it('passes PGVERBOSITY=verbose to the password psql child', () => {
    if (typeof databaseBoot.passwordPsqlEnv !== 'function') {
      throw new Error('passwordPsqlEnv is not exported');
    }
    const env = databaseBoot.passwordPsqlEnv({
      PATH: '/bin',
      HOME: '/tmp',
      PGVERBOSITY: 'default',
      LC_ALL: 'en_US.UTF-8',
      LANG: 'en_US.UTF-8',
    });
    expect(env.PGVERBOSITY).toBe('verbose');
    expect(env.LC_ALL).toBe('C');
    expect(env.LANG).toBe('C');
    expect(env.PATH).toBe('/bin');
    expect(env.HOME).toBe('/tmp');
    const body = functionBody(entry, 'setAppRolePassword');
    expect(body).toContain('passwordPsqlEnv(');
    expect(spawnCall('setAppRolePassword')).toContain('childEnv(');
  });

  it('rejects a -c variant in the password psql argv', () => {
    if (typeof databaseBoot.assertPsqlArgsHaveNoCommand !== 'function') {
      throw new Error('assertPsqlArgsHaveNoCommand is not exported');
    }
    const spawn = spawnCall('setAppRolePassword');
    // WHY: -c puts the ALTER text on the command line. The verifier would
    // then show up in argv. The password statement is stdin.
    expect(spawn).not.toMatch(/['"]-c['"]/);
    expect(spawn).not.toMatch(/--command/);
    expect(spawn).toContain('assertPsqlArgsHaveNoCommand(');
    expect(() =>
      databaseBoot.assertPsqlArgsHaveNoCommand(['-d', 'bidstack', '-c', 'select 1']),
    ).toThrow(/not allowed/);
    expect(() => databaseBoot.assertPsqlArgsHaveNoCommand(['--command', 'select 1'])).toThrow(
      /not allowed/,
    );
    expect(() => databaseBoot.assertPsqlArgsHaveNoCommand(['--command=select 1'])).toThrow(
      /not allowed/,
    );
    expect(() => databaseBoot.assertPsqlArgsHaveNoCommand('psql -c select 1')).toThrow(/list/);
    expect(
      databaseBoot.assertPsqlArgsHaveNoCommand(['-d', 'bidstack', '-v', 'ON_ERROR_STOP=1', '-q']),
    ).toEqual(['-d', 'bidstack', '-v', 'ON_ERROR_STOP=1', '-q']);
  });

  it('allows drill hooks only when the flag is 1 and the environment is not production', () => {
    if (typeof databaseBoot.drillHooksAllowed !== 'function') {
      throw new Error('drillHooksAllowed is not exported');
    }
    expect(
      databaseBoot.drillHooksAllowed({ POLO_RESTORE_DRILL: '1', NODE_ENV: 'production' }),
    ).toBe(false);
    expect(
      databaseBoot.drillHooksAllowed({ POLO_RESTORE_DRILL: '1', NODE_ENV: 'Production' }),
    ).toBe(false);
    expect(databaseBoot.drillHooksAllowed({ POLO_RESTORE_DRILL: '1' })).toBe(true);
    const password = functionBody(entry, 'setAppRolePassword');
    const gate = functionBody(entry, 'assertAppRoleGate');
    expect(password).toContain('selectDrillHooks(');
    expect(gate).toContain('selectDrillHooks(');
    expect(password).not.toMatch(/POLO_RESTORE_DRILL\s*[!=]==/);
    expect(gate).not.toMatch(/POLO_RESTORE_DRILL\s*[!=]==/);
  });

  it('proves the production container sources never set POLO_RESTORE_DRILL', () => {
    // WHY: the drill flag is a test switch. A production file that assigns it
    // would turn the fault hooks on for every container boot.
    const files = [
      '../container/entrypoint.mjs',
      '../container/Dockerfile',
      '../wrangler.toml',
      'worker.js',
      'index.js',
      'start-box.mjs',
      'container-env.js',
      'polo-container.js',
    ];
    for (const file of files) {
      const source = readFileSync(join(here, file), 'utf8');
      expect(assignsDrillFlag(source), file).toBe(false);
    }
    expect(assignsDrillFlag('process.env.POLO_RESTORE_DRILL = "1"')).toBe(true);
    expect(assignsDrillFlag("POLO_RESTORE_DRILL='1'")).toBe(true);
    expect(assignsDrillFlag("process.env.POLO_RESTORE_DRILL !== '1'")).toBe(false);
    expect(assignsDrillFlag("process.env.POLO_RESTORE_DRILL === '1'")).toBe(false);
  });

  it('catches an object-form drill flag in the container sources', () => {
    // WHY: POLO_RESTORE_DRILL: '1' is an assignment the equals-only scan misses,
    // and container-env.js plus polo-container.js were not in the file list.
    expect(assignsDrillFlag("{ POLO_RESTORE_DRILL: '1' }")).toBe(true);
    expect(assignsDrillFlag('{ POLO_RESTORE_DRILL: "1" }')).toBe(true);
    for (const file of ['container-env.js', 'polo-container.js']) {
      expect(assignsDrillFlag(readFileSync(join(here, file), 'utf8')), file).toBe(false);
    }
  });
});

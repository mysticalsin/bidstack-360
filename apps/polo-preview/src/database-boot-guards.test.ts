// WHY: each transition has a guard. A boot that skips one would reach Ready
// after a failed init, a second copy of the public schema, or a drill hook
// that production must not run.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as databaseBoot from './database-boot.js';

const self = readFileSync(fileURLToPath(import.meta.url), 'utf8');
const PUBLIC_NOTICE =
  'pg_restore: error: could not execute query: ERROR:  42P06: schema "public" already exists';

type Boot = {
  state: string;
  reason: string;
  terminal: boolean;
  transitions: Array<{ guard: boolean; reason: string; to: string; infrastructure: boolean }>;
  send: (event: Record<string, unknown>) => {
    guard: boolean;
    reason: string;
    to: string;
    from: string;
    infrastructure: boolean;
  };
};

function machine(): Boot {
  if (typeof databaseBoot.createDatabaseBoot !== 'function') {
    throw new Error('createDatabaseBoot is not exported');
  }
  return databaseBoot.createDatabaseBoot() as Boot;
}

function atAppRole(): Boot {
  const boot = machine();
  boot.send({ type: 'cluster-ready', ready: true });
  return boot;
}

function atDrill(): Boot {
  const boot = atAppRole();
  boot.send({ type: 'skip-restore', how: 'seed' });
  expect(boot.state).toBe('DrillHooks');
  return boot;
}

describe('database boot guards', () => {
  it('does not skip or mark a case expected to fail', () => {
    const banned = [`.${'skip'}(`, `x${'it'}(`, `x${'test'}(`, `x${'describe'}(`, `x${'fail'}`];
    for (const part of banned) expect(self.includes(part)).toBe(false);
  });

  it('refuses to leave Init until the cluster is actually ready', () => {
    const boot = machine();
    const entry = boot.send({ type: 'cluster-ready', ready: false });
    expect(entry).toMatchObject({
      from: 'Init',
      to: 'Failed',
      guard: false,
      reason: 'cluster is not ready',
    });
    expect(boot.terminal).toBe(true);
  });

  it('refuses an init failure that does not say why', () => {
    const boot = machine();
    const entry = boot.send({ type: 'init-failed', reason: '   ' });
    expect(entry.guard).toBe(false);
    expect(boot.reason).toBe('init failed without a reason');
    expect(boot.state).toBe('Failed');
  });

  it('accepts an init failure that names the reason', () => {
    const boot = machine();
    const entry = boot.send({ type: 'init-failed', reason: 'initdb exited 1' });
    expect(entry.guard).toBe(true);
    expect(boot.reason).toBe('initdb exited 1');
    expect(boot.state).toBe('Failed');
  });

  it('refuses a restore result that has no exit status', () => {
    const boot = atAppRole();
    const entry = boot.send({ type: 'restore-result', status: undefined, text: '' });
    expect(entry).toMatchObject({
      to: 'Failed',
      guard: false,
      reason: 'restore result is not classifiable',
    });
    expect(boot.transitions.some((item) => item.to === 'TolerateDuplicateSchema')).toBe(false);
  });

  it('treats a null exit as a failed restore after the tolerate state', () => {
    // WHY: spawnSync reports a missing binary as status null. That is not the
    // one tolerated notice, and it must not be read as success.
    const boot = atAppRole();
    boot.send({ type: 'restore-result', status: null, text: '' });
    expect(boot.transitions.map((item) => item.to)).toEqual([
      'AppRoleRestore',
      'TolerateDuplicateSchema',
      'Failed',
    ]);
    expect(boot.reason).toBe(databaseBoot.restoreFailure(null, ''));
  });

  it('refuses to skip the restore on the restore path', () => {
    const boot = atAppRole();
    const entry = boot.send({ type: 'skip-restore', how: 'restore' });
    expect(entry.guard).toBe(false);
    expect(boot.reason).toBe('skip-restore is only for a seed boot');
  });

  it('refuses Ready without a restore or a seed', () => {
    const boot = atDrill();
    const entry = boot.send({ type: 'gate-passed', how: '' });
    expect(entry.guard).toBe(false);
    expect(boot.reason).toBe('ready needs a restore or a seed');
    expect(boot.state).toBe('Failed');
  });

  it('rejects a zero exit that still printed the public schema notice', () => {
    const boot = atAppRole();
    boot.send({ type: 'restore-result', status: 0, text: PUBLIC_NOTICE });
    expect(boot.state).toBe('Failed');
    expect(boot.transitions.at(-1)?.guard).toBe(false);
    expect(boot.reason).toBe(databaseBoot.restoreFailure(0, PUBLIC_NOTICE));
  });

  it('rejects an event from the wrong state', () => {
    const boot = machine();
    const entry = boot.send({ type: 'gate-passed', how: 'restore' });
    expect(entry.guard).toBe(false);
    expect(boot.reason).toBe('illegal transition Init gate-passed');
    const later = atAppRole();
    later.send({ type: 'apply-drill-hooks', env: {} });
    expect(later.reason).toBe('illegal transition AppRoleRestore apply-drill-hooks');
  });

  it('keeps a refused drill hook in DrillHooks instead of calling it success', () => {
    const boot = atDrill();
    const entry = boot.send({
      type: 'apply-drill-hooks',
      env: { POLO_RESTORE_DRILL: '1', NODE_ENV: 'production', POLO_GATE_BREAK: 'audit-trigger' },
    });
    expect(entry).toMatchObject({
      from: 'DrillHooks',
      to: 'DrillHooks',
      guard: false,
      reason: 'drill hooks refused',
    });
    expect(boot.state).toBe('DrillHooks');
    expect(boot.terminal).toBe(false);
  });

  it('applies a drill hook only when the flag is on and the env is not production', () => {
    const boot = atDrill();
    const entry = boot.send({
      type: 'apply-drill-hooks',
      env: { POLO_RESTORE_DRILL: '1', NODE_ENV: 'test', POLO_DROP_APP_ROLE: '1' },
    });
    expect(entry).toMatchObject({ guard: true, reason: 'drill hooks applied', to: 'DrillHooks' });
  });

  it('property: the drill flag allows hooks only outside production', () => {
    if (typeof databaseBoot.drillHooksAllowed !== 'function') {
      throw new Error('drillHooksAllowed is not exported');
    }
    const flags = [undefined, '', '0', '1', 'true', '1 ', 'yes'] as const;
    const nodes = [
      undefined,
      '',
      'production',
      'Production',
      'PRODUCTION',
      'test',
      'development',
      'prod',
    ];
    for (const flag of flags) {
      for (const node of nodes) {
        const env: Record<string, string> = {};
        if (flag !== undefined) env.POLO_RESTORE_DRILL = flag;
        if (node !== undefined) env.NODE_ENV = node;
        const allowed = databaseBoot.drillHooksAllowed(env);
        const expectAllowed = flag === '1' && String(node || '').toLowerCase() !== 'production';
        expect(allowed, JSON.stringify(env)).toBe(expectAllowed);
      }
    }
    expect(databaseBoot.drillHooksAllowed(undefined)).toBe(false);
    expect(databaseBoot.drillHooksAllowed(null)).toBe(false);
  });

  it('boundary: role names and hook selectors', () => {
    if (typeof databaseBoot.selectDrillHooks !== 'function') {
      throw new Error('selectDrillHooks is not exported');
    }
    const blocked = databaseBoot.selectDrillHooks({
      POLO_RESTORE_DRILL: '1',
      NODE_ENV: 'production',
      POLO_DROP_APP_ROLE: '1',
      POLO_GATE_BREAK: 'audit-trigger',
      POLO_PASSWORD_TARGET_ROLE: 'no_such_role',
    });
    expect(blocked).toEqual({
      allowed: false,
      dropAppRole: false,
      gateBreak: '',
      passwordRole: 'app_role',
    });
    const open = databaseBoot.selectDrillHooks({
      POLO_RESTORE_DRILL: '1',
      POLO_DROP_APP_ROLE: '1',
      POLO_GATE_BREAK: 'audit-trigger-replica',
      POLO_PASSWORD_TARGET_ROLE: 'no_such_role',
    });
    expect(open).toEqual({
      allowed: true,
      dropAppRole: true,
      gateBreak: 'audit-trigger-replica',
      passwordRole: 'no_such_role',
    });
    const max = 'a'.repeat(63);
    expect(
      databaseBoot.selectDrillHooks({ POLO_RESTORE_DRILL: '1', POLO_PASSWORD_TARGET_ROLE: max })
        .passwordRole,
    ).toBe(max);
    expect(() =>
      databaseBoot.selectDrillHooks({
        POLO_RESTORE_DRILL: '1',
        POLO_PASSWORD_TARGET_ROLE: 'a'.repeat(64),
      }),
    ).toThrow(/not a role name/);
    expect(() =>
      databaseBoot.selectDrillHooks({ POLO_RESTORE_DRILL: '1', POLO_PASSWORD_TARGET_ROLE: '1bad' }),
    ).toThrow(/not a role name/);
    expect(
      databaseBoot.selectDrillHooks({ POLO_RESTORE_DRILL: '1', POLO_DROP_APP_ROLE: '0' })
        .dropAppRole,
    ).toBe(false);
  });

  it('counts a timeout as an infrastructure failure', () => {
    if (typeof databaseBoot.classifyBootFailure !== 'function') {
      throw new Error('classifyBootFailure is not exported');
    }
    const timed = Object.assign(new Error('hook timed out'), { code: 'ETIMEDOUT' });
    expect(databaseBoot.classifyBootFailure(timed)).toEqual({
      infrastructure: true,
      reason: 'infrastructure: hook timed out',
    });
    expect(
      databaseBoot.classifyBootFailure(new Error('Test timed out in 10000ms')).infrastructure,
    ).toBe(true);
    expect(databaseBoot.classifyBootFailure('migrate exited 1')).toEqual({
      infrastructure: false,
      reason: 'migrate exited 1',
    });
    const boot = atDrill();
    const entry = boot.send({ type: 'boot-failed', error: timed });
    expect(entry.infrastructure).toBe(true);
    expect(entry.guard).toBe(true);
    expect(entry.reason).toBe('infrastructure: hook timed out');
    expect(boot.state).toBe('Failed');
    expect(boot.terminal).toBe(true);
  });

  it('refuses a boot failure that has an empty reason', () => {
    const boot = atDrill();
    const entry = boot.send({ type: 'boot-failed', reason: '' });
    expect(entry.guard).toBe(false);
    expect(boot.reason).toBe('boot failed without a reason');
    expect(boot.state).toBe('Failed');
  });

  it('does not replace a Ready reason when a later event arrives', () => {
    const boot = atDrill();
    boot.send({ type: 'gate-passed', how: 'seed' });
    const entry = boot.send({ type: 'boot-failed', reason: 'later' });
    expect(entry).toMatchObject({ from: 'Ready', to: 'Ready', guard: false, reason: 'terminal' });
    expect(boot.reason).toBe('seed');
  });
});

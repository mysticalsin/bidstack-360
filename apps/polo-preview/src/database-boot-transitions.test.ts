// WHY: the database boot is a sequence of decisions. Naming the states and
// logging every transition is what makes a missed step visible. These tests
// describe that sequence before the machine exists.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as databaseBoot from './database-boot.js';

const here = dirname(fileURLToPath(import.meta.url));
const entry = readFileSync(join(here, '../container/entrypoint.mjs'), 'utf8');
const self = readFileSync(fileURLToPath(import.meta.url), 'utf8');

const PUBLIC_NOTICE =
  'pg_restore: error: could not execute query: ERROR:  42P06: schema "public" already exists';

const STATES = [
  'Init',
  'AppRoleRestore',
  'TolerateDuplicateSchema',
  'DrillHooks',
  'Ready',
  'Failed',
];

type Boot = {
  state: string;
  reason: string;
  terminal: boolean;
  transitions: Array<{
    from: string;
    event: string;
    to: string;
    guard: boolean;
    reason: string;
    infrastructure: boolean;
  }>;
  send: (event: Record<string, unknown> | null) => {
    from: string;
    event: string;
    to: string;
    guard: boolean;
    reason: string;
    infrastructure: boolean;
  };
};

function machine(log?: (entry: Boot['transitions'][number]) => void): Boot {
  // A missing export has to fail the assertion, not get skipped.
  if (typeof databaseBoot.createDatabaseBoot !== 'function') {
    throw new Error('createDatabaseBoot is not exported');
  }
  return databaseBoot.createDatabaseBoot(log ? { log } : undefined) as Boot;
}

function assertClosed(boot: Boot): void {
  expect(STATES).toContain(boot.state);
  expect(boot.terminal).toBe(boot.state === 'Ready' || boot.state === 'Failed');
  if (boot.state === 'Ready') expect(['restore', 'seed']).toContain(boot.reason);
  if (boot.state === 'Failed') expect(boot.reason.length).toBeGreaterThan(0);
  let sawReady = false;
  let sawFailed = false;
  for (const entry of boot.transitions) {
    expect(STATES).toContain(entry.from);
    expect(STATES).toContain(entry.to);
    expect(typeof entry.event).toBe('string');
    expect(typeof entry.guard).toBe('boolean');
    expect(typeof entry.reason).toBe('string');
    expect(typeof entry.infrastructure).toBe('boolean');
    // A rejected guard must not be reported as ready.
    if (!entry.guard && entry.from !== 'Ready') expect(entry.to).not.toBe('Ready');
    if (entry.infrastructure) {
      expect(entry.to).toBe('Failed');
      expect(entry.reason.startsWith('infrastructure:')).toBe(true);
    }
    if (sawReady && entry.to !== 'Ready') throw new Error('left Ready');
    if (sawFailed && entry.to !== 'Failed') throw new Error('left Failed');
    if (entry.to === 'Ready') sawReady = true;
    if (entry.to === 'Failed') sawFailed = true;
  }
}

describe('database boot transitions', () => {
  it('does not skip or mark a case expected to fail', () => {
    // Spellings are built at runtime so this file does not contain them.
    const banned = [`.${'skip'}(`, `x${'it'}(`, `x${'test'}(`, `x${'describe'}(`, `x${'fail'}`];
    for (const part of banned) expect(self.includes(part)).toBe(false);
  });

  it('names Init, the restore steps, the drill, and one terminal', () => {
    expect(Object.values(databaseBoot.BOOT_STATES ?? {}).sort()).toEqual([...STATES].sort());
    const boot = machine();
    expect(boot.state).toBe('Init');
    expect(boot.terminal).toBe(false);
    expect(boot.transitions).toEqual([]);
  });

  it('walks a duplicate public schema through every state to Ready', () => {
    const seen: Boot['transitions'] = [];
    const boot = machine((entry) => seen.push(entry));
    boot.send({ type: 'cluster-ready', ready: true });
    boot.send({ type: 'restore-result', status: 1, text: PUBLIC_NOTICE });
    boot.send({ type: 'apply-drill-hooks', env: {} });
    boot.send({ type: 'app-role-gate', verdict: 'ok' });
    boot.send({ type: 'gate-passed', how: 'restore' });
    // WHY: one send of the restore result has to record the tolerate step,
    // not jump from the role straight to the drill.
    expect(boot.transitions).toEqual([
      {
        from: 'Init',
        event: 'cluster-ready',
        to: 'AppRoleRestore',
        guard: true,
        reason: '',
        infrastructure: false,
      },
      {
        from: 'AppRoleRestore',
        event: 'restore-result',
        to: 'TolerateDuplicateSchema',
        guard: true,
        reason: '',
        infrastructure: false,
      },
      {
        from: 'TolerateDuplicateSchema',
        event: 'restore-result',
        to: 'DrillHooks',
        guard: true,
        reason: 'duplicate public schema once',
        infrastructure: false,
      },
      {
        from: 'DrillHooks',
        event: 'apply-drill-hooks',
        to: 'DrillHooks',
        guard: true,
        reason: 'no drill hooks',
        infrastructure: false,
      },
      {
        from: 'DrillHooks',
        event: 'app-role-gate',
        to: 'DrillHooks',
        guard: true,
        reason: 'app role gate verified',
        infrastructure: false,
      },
      {
        from: 'DrillHooks',
        event: 'gate-passed',
        to: 'Ready',
        guard: true,
        reason: 'restore',
        infrastructure: false,
      },
    ]);
    expect(boot.state).toBe('Ready');
    expect(boot.reason).toBe('restore');
    expect(boot.terminal).toBe(true);
    expect(seen).toEqual(boot.transitions);
  });

  it('accepts a clean restore and a seed without pretending a dump was classified', () => {
    const clean = machine();
    clean.send({ type: 'cluster-ready', ready: true });
    clean.send({ type: 'restore-result', status: 0, text: '' });
    expect(clean.state).toBe('DrillHooks');
    expect(clean.transitions.map((entry) => entry.reason)).toEqual(['', '', 'clean restore']);

    const seed = machine();
    seed.send({ type: 'cluster-ready', ready: true });
    seed.send({ type: 'skip-restore', how: 'seed' });
    seed.send({ type: 'app-role-gate', verdict: 'ok' });
    seed.send({ type: 'gate-passed', how: 'seed' });
    expect(seed.transitions.map((entry) => entry.to)).toEqual([
      'AppRoleRestore',
      'DrillHooks',
      'DrillHooks',
      'Ready',
    ]);
    expect(seed.reason).toBe('seed');
    expect(seed.transitions.some((entry) => entry.to === 'TolerateDuplicateSchema')).toBe(false);
  });

  it('fails a notice that is printed twice and still records the tolerate state', () => {
    const twice = `${PUBLIC_NOTICE}\n${PUBLIC_NOTICE}`;
    const boot = machine();
    boot.send({ type: 'cluster-ready', ready: true });
    boot.send({ type: 'restore-result', status: 1, text: twice });
    expect(boot.transitions.map((entry) => entry.to)).toEqual([
      'AppRoleRestore',
      'TolerateDuplicateSchema',
      'Failed',
    ]);
    expect(boot.terminal).toBe(true);
    expect(boot.reason).toBe(databaseBoot.restoreFailure(1, twice));
    expect(boot.transitions.at(-1)?.guard).toBe(false);
  });

  it('stays on the terminal it already reached', () => {
    const boot = machine();
    boot.send({ type: 'init-failed', reason: 'initdb exited 1' });
    const first = boot.reason;
    const extra = boot.send({ type: 'cluster-ready', ready: true });
    expect(extra).toMatchObject({ from: 'Failed', to: 'Failed', guard: false, reason: 'terminal' });
    expect(boot.state).toBe('Failed');
    expect(boot.reason).toBe(first);
  });

  it('drives the container boot with the same event names', () => {
    // WHY: a machine that only the tests call would leave the sequential boot
    // in the entrypoint. The supervisor has to send each event.
    expect(entry).toContain('createDatabaseBoot(');
    for (const event of [
      'cluster-ready',
      'restore-result',
      'skip-restore',
      'apply-drill-hooks',
      'app-role-gate',
      'gate-passed',
      'init-failed',
      'boot-failed',
    ]) {
      expect(entry).toContain(`type: '${event}'`);
    }
  });

  it('property: random events stay inside one terminal', () => {
    const started = Date.now();
    const pool: Array<Record<string, unknown>> = [
      { type: 'cluster-ready', ready: true },
      { type: 'cluster-ready', ready: false },
      { type: 'init-failed', reason: 'initdb exited 1' },
      { type: 'init-failed', reason: '   ' },
      { type: 'restore-result', status: 0, text: '' },
      { type: 'restore-result', status: 1, text: PUBLIC_NOTICE },
      { type: 'restore-result', status: 1, text: `${PUBLIC_NOTICE}\n${PUBLIC_NOTICE}` },
      { type: 'restore-result', status: 0, text: PUBLIC_NOTICE },
      { type: 'restore-result', status: null, text: '' },
      { type: 'skip-restore', how: 'seed' },
      { type: 'skip-restore', how: 'restore' },
      { type: 'apply-drill-hooks', env: {} },
      {
        type: 'apply-drill-hooks',
        env: { POLO_RESTORE_DRILL: '1', NODE_ENV: 'production', POLO_GATE_BREAK: 'audit-trigger' },
      },
      {
        type: 'apply-drill-hooks',
        env: { POLO_RESTORE_DRILL: '1', POLO_PASSWORD_TARGET_ROLE: 'Bad Role' },
      },
      { type: 'gate-passed', how: 'restore' },
      { type: 'gate-passed', how: 'seed' },
      { type: 'gate-passed', how: '' },
      { type: 'boot-failed', reason: 'migrate exited 1' },
      { type: 'boot-failed', reason: '' },
      {
        type: 'boot-failed',
        error: Object.assign(new Error('hook timed out'), { code: 'ETIMEDOUT' }),
      },
      { type: 'not-an-event' },
    ];
    let seed = 0x5eed;
    const next = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    try {
      for (let run = 0; run < 40; run += 1) {
        const boot = machine();
        const steps = 8 + Math.floor(next() * 8);
        for (let i = 0; i < steps; i += 1) {
          const event = pool[Math.floor(next() * pool.length)] ?? { type: 'not-an-event' };
          boot.send(event);
          if (Date.now() - started > 8_000) {
            throw new Error('infrastructure: property run exceeded its budget');
          }
        }
        boot.send(null);
        assertClosed(boot);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (Date.now() - started > 8_000 || /timeout/i.test(message)) {
        throw new Error(`infrastructure: ${message}`, { cause: error });
      }
      throw error;
    }
  });
});

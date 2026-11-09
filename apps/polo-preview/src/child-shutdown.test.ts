import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { describe, expect, it } from 'vitest';

import { stopChildren } from './child-shutdown.js';

// WHY: the supervisor used to signal its children and exit at once, so the
// container ended while the API drained requests and the worker its job.
// Shutdown must wait for every child to exit, bound that wait with a SIGKILL,
// and report through the exit code whether the stop was clean.

/** A real child that announces readiness, then handles SIGTERM as `onTerm` says. */
async function child(onTerm: string): Promise<ChildProcess> {
  const proc = spawn(
    process.execPath,
    ['-e', `process.on('SIGTERM', () => { ${onTerm} }); process.stdout.write('ready'); setInterval(() => {}, 1000);`],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  );
  await once(proc.stdout!, 'data');
  return proc;
}

const DRAIN_MS = 300;

describe('stopChildren', () => {
  it('waits for children that drain before exiting, and exits 0', async () => {
    const api = await child(`setTimeout(() => process.exit(0), ${DRAIN_MS})`);
    const worker = await child(`setTimeout(() => process.exit(0), ${DRAIN_MS / 2})`);
    const started = Date.now();

    const code = await stopChildren([['api', api], ['worker', worker]], { graceMs: 5_000 });

    expect(Date.now() - started).toBeGreaterThanOrEqual(DRAIN_MS - 20);
    expect([api.exitCode, worker.exitCode]).toEqual([0, 0]);
    expect(code).toBe(0);
  });

  it('SIGKILLs a child still running after the grace period, and exits 1', async () => {
    const stuck = await child('/* ignores SIGTERM */');
    const logs: string[] = [];
    const started = Date.now();

    const code = await stopChildren([['worker', stuck]], { graceMs: 200, log: (m) => logs.push(m) });

    expect(Date.now() - started).toBeLessThan(3_000);
    expect(stuck.signalCode).toBe('SIGKILL');
    expect(code).toBe(1);
    expect(logs.join('\n')).toContain('worker still running after 200ms; sending SIGKILL');
  });

  it('exits 1 when a child fails its own shutdown', async () => {
    const api = await child('process.exit(1)');
    expect(await stopChildren([['api', api]], { graceMs: 5_000 })).toBe(1);
  });

  it('skips children that are absent or already exited', async () => {
    const gone = await child('process.exit(0)');
    gone.kill('SIGTERM');
    await once(gone, 'exit');

    expect(await stopChildren([['api', null], ['worker', gone]], { graceMs: 200 })).toBe(0);
  });
});

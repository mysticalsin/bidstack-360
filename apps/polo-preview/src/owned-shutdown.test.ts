import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const entrypoint = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../container/entrypoint.mjs'),
  'utf8',
);

describe('node supervisor shutdown', () => {
  it('stops only the api and worker handles this process spawned, and waits for them', () => {
    // WHY: this supervisor has no unverified pid list. SIGTERM goes through the
    // ChildProcess handles it stored (stopChildren, tested in
    // child-shutdown.test.ts); a raw process.kill would be a different path,
    // and this test fails if one is added. The process exits only once
    // stopChildren settles, with its code, not with a hard-coded 0.
    const start = entrypoint.indexOf("process.on('SIGTERM'");
    expect(start).toBeGreaterThan(-1);
    const handler = entrypoint.slice(start);
    expect(handler).toContain("stopChildren([['api', apiChild], ['worker', workerChild]]");
    expect(handler).toContain('process.exit(code)');
    expect(handler).not.toContain('process.exit(0)');
    expect(entrypoint).not.toContain('process.kill(');
  });

  it('does not restart a child, or exit early on a database exit, while stopping', () => {
    // WHY: the api and worker exit handlers schedule restarts; during a stop a
    // restart would respawn the child being waited for, and the postgres and
    // redis handlers would cut the wait short with exit 1.
    for (const marker of ['function startApi() {', 'function startWorker() {']) {
      const body = entrypoint.slice(entrypoint.indexOf(marker), entrypoint.indexOf(marker) + 80);
      expect(body).toContain('if (stopping) return;');
    }
    expect(entrypoint).toContain("if (stopping || phase !== 'ready') return;");
    for (const name of ['pg', 'redis', 'workerChild']) {
      const at = entrypoint.indexOf(`${name}.on('exit'`);
      expect(at).toBeGreaterThan(-1);
      expect(entrypoint.slice(at, at + 120)).toContain('if (stopping) return;');
    }
  });
});

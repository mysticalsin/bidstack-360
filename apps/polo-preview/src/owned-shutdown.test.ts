import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const entrypoint = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../container/entrypoint.mjs'),
  'utf8',
);

describe('node supervisor shutdown', () => {
  it('signals only the api and worker handles this process spawned', () => {
    // WHY: this supervisor has no unverified pid list. SIGTERM uses the
    // ChildProcess handles it stored. A raw process.kill would be a different
    // path, and this test fails if one is added. The handler then exits. It
    // does not wait, and it does not claim a child pid was reused.
    const start = entrypoint.indexOf("process.on('SIGTERM'");
    expect(start).toBeGreaterThan(-1);
    const handler = entrypoint.slice(start);
    expect(handler).toContain("apiChild?.kill('SIGTERM')");
    expect(handler).toContain("workerChild?.kill('SIGTERM')");
    expect(handler).toContain('process.exit(0)');
    expect(entrypoint).not.toContain('process.kill(');
    expect(handler).not.toContain('wait(');
  });
});
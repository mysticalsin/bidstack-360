import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

describe('preview queue worker', () => {
  it('builds the worker image and starts it only after Postgres is ready', () => {
    // The API enqueues MSA extract and crew runs into the container Redis.
    // Those jobs stay pending unless this image both compiles and launches
    // @bidstack/worker against that same Redis and database.
    const dockerfile = readFileSync(join(here, '..', 'Dockerfile'), 'utf8');
    const entry = readFileSync(join(here, 'preview-entrypoint.sh'), 'utf8');
    expect(dockerfile).toContain('pnpm --filter @bidstack/worker build');
    expect(dockerfile).toContain('apps/worker/dist/main.js');
    const readyAt = entry.indexOf('if [[ "${ready}" == "1" ]]');
    const apiAt = entry.indexOf('starting api');
    const workerAt = entry.indexOf('starting queue worker');
    const launchAt = entry.indexOf('cd /app/apps/worker && node dist/main.js');
    expect(readyAt).toBeGreaterThan(-1);
    expect(apiAt).toBeGreaterThan(readyAt);
    expect(workerAt).toBeGreaterThan(apiAt);
    expect(launchAt).toBeGreaterThan(workerAt);
    expect(entry.indexOf('postgres did not become ready')).toBeGreaterThan(launchAt);
  });
});

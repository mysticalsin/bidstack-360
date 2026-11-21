import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const vitestEntry = path.join(path.dirname(require.resolve('vitest/package.json')), 'vitest.mjs');

function runZone(tz: string) {
  return spawnSync(
    process.execPath,
    [vitestEntry, 'run', '--config', 'vitest.date-zones.config.ts', 'src/lib/plain-date.test.ts'],
    {
      cwd: webRoot,
      env: { ...process.env, TZ: tz },
      encoding: 'utf8',
    },
  );
}

describe('date-only calendar days west of UTC', () => {
  it('holds the written day in America/Sao_Paulo', () => {
    const result = runZone('America/Sao_Paulo');
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  }, 60_000);

  it('holds the written day in America/Los_Angeles', () => {
    const result = runZone('America/Los_Angeles');
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  }, 60_000);
});

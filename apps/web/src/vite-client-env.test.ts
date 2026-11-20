import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadEnv } from 'vite';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

describe('Vite client env for real mode', () => {
  it('reads apps/web/.env.development.local, not the repo-root .env', () => {
    const config = readFileSync(resolve(root, 'apps/web/vite.config.ts'), 'utf8');
    // No envDir: Vite's client root is the web package, so import.meta.env
    // never sees the repo-root .env. pnpm dev:web sets VITE_AUTH_MODE=stub
    // in the process, and that wins over the file.
    expect(config).not.toMatch(/\benvDir\s*:/);
    expect(readFileSync(resolve(root, 'apps/web/package.json'), 'utf8')).toContain(
      'cross-env VITE_AUTH_MODE=stub vite',
    );

    const parent = mkdtempSync(join(tmpdir(), 'polo-vite-env-'));
    const web = join(parent, 'apps', 'web');
    mkdirSync(web, { recursive: true });
    const saved = process.env.VITE_AUTH_MODE;
    delete process.env.VITE_AUTH_MODE;
    try {
      writeFileSync(join(parent, '.env'), 'VITE_AUTH_MODE=cf-access\n');
      expect(loadEnv('development', web, 'VITE_').VITE_AUTH_MODE).toBeUndefined();

      writeFileSync(join(web, '.env.development.local'), 'VITE_AUTH_MODE=cf-access\n');
      expect(loadEnv('development', web, 'VITE_').VITE_AUTH_MODE).toBe('cf-access');

      process.env.VITE_AUTH_MODE = 'stub';
      expect(loadEnv('development', web, 'VITE_').VITE_AUTH_MODE).toBe('stub');
    } finally {
      if (saved === undefined) delete process.env.VITE_AUTH_MODE;
      else process.env.VITE_AUTH_MODE = saved;
      rmSync(parent, { recursive: true, force: true });
    }
  });
});

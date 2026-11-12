import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// WHY: an unpinned `npx railway` / `npx vercel` / `npx wrangler` fetches
// whatever the registry calls latest at deploy time. A compromised or
// swapped release would run with the production token. The workflow and
// the deploy scripts must call a binary installed from a lockfile whose
// integrity hashes npm ci verifies.

const repo = join(dirname(fileURLToPath(import.meta.url)), '../../../..');

const UNPINNED =
  /\bnpx(?:\s+-[yY])?\s+(?:railway|vercel|wrangler|@railway\/cli)\b|\b(?:railway|vercel|wrangler)@latest\b/;
const BARE_SPAWN =
  /(?:spawnSync|run)\(\s*['"](?:railway|vercel|wrangler)['"]/;

describe('deploy CLIs are pinned', () => {
  it('workflows and deploy scripts do not fetch an unpinned CLI', () => {
    const files = [
      ...readdirSync(join(repo, '.github/workflows')).map((name) =>
        join(repo, '.github/workflows', name),
      ),
      ...readdirSync(join(repo, 'scripts'))
        .filter((name) => name.endsWith('.mjs') || name.endsWith('.sh'))
        .map((name) => join(repo, 'scripts', name)),
    ];
    const hits: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      if (UNPINNED.test(text) || BARE_SPAWN.test(text)) hits.push(file.slice(repo.length + 1));
    }
    expect(hits).toEqual([]);
  });

  it('locks railway, vercel, and wrangler to exact versions with integrity hashes', () => {
    const pkg = JSON.parse(readFileSync(join(repo, 'deploy/cli/package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    for (const name of ['@railway/cli', 'vercel', 'wrangler']) {
      expect(pkg.dependencies[name]).toMatch(/^\d+\.\d+\.\d+$/);
    }
    const parsed = JSON.parse(
      readFileSync(join(repo, 'deploy/cli/package-lock.json'), 'utf8'),
    ) as { packages: Record<string, { version?: string; integrity?: string }> };
    for (const name of ['node_modules/@railway/cli', 'node_modules/vercel', 'node_modules/wrangler']) {
      expect(parsed.packages[name]?.version).toBe(pkg.dependencies[name.replace('node_modules/', '')]);
      expect(parsed.packages[name]?.integrity).toMatch(/^sha512-/);
    }
  });
});

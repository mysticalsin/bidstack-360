// F-05: pnpm.overrides must not pin Vite or Hono below the patched releases.
// Vite 6.4.4 is CVE-2026-118662 (server.fs.deny bypass). Hono 4.13.14 is
// CVE-2026-126355, CVE-2026-126356, CVE-2026-126357, and CVE-2026-126358.
// The lockfile has to follow the override or the pin is only a manifest lie.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

function semverAtLeast(version: string, floor: readonly [number, number, number]): boolean {
  const parts = version.split('.').map((part) => Number(part));
  for (let i = 0; i < 3; i += 1) {
    const got = parts[i] ?? 0;
    const want = floor[i] ?? 0;
    if (got > want) return true;
    if (got < want) return false;
  }
  return true;
}

describe('patched dependency overrides', () => {
  it('pins Vite and Hono at or above the advisory floors, including the lockfile', () => {
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      pnpm: { overrides: Record<string, string> };
    };
    const overrides = pkg.pnpm.overrides;
    expect(semverAtLeast(overrides.vite ?? '0.0.0', [6, 4, 5])).toBe(true);
    expect(semverAtLeast(overrides.hono ?? '0.0.0', [4, 13, 16])).toBe(true);

    const lock = readFileSync(resolve(root, 'pnpm-lock.yaml'), 'utf8');
    expect(lock).not.toContain('\n  vite@6.4.4:');
    expect(lock).not.toContain('\n  hono@4.13.14:');
    expect(lock).toMatch(/\n {2}vite@6\.4\.(?:[5-9]|[1-9]\d+):/);
    expect(lock).toMatch(/\n {2}hono@4\.13\.(?:1[6-9]|[2-9]\d+):/);
  });
});

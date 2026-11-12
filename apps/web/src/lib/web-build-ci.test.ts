import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The unit job is the required CI gate. A Vite build that lives only on the
 * e2e job does not run for a branch push, so a node built-in in the shared
 * root can blank every route without failing CI.
 */
const ci = readFileSync(resolve(process.cwd(), '../../.github/workflows/ci.yml'), 'utf8');

function unitJob(): string {
  const start = ci.indexOf('  unit:');
  const end = ci.indexOf('  secrets-full-scan:');
  return ci.slice(start, end);
}

describe('CI web build gate', () => {
  it('runs the web vite build in the unit job', () => {
    expect(unitJob()).toContain('pnpm --filter @bidstack/web build');
  });
});

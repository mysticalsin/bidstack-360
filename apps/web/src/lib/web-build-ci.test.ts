import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The unit job is the required CI gate. It must run the same script the
 * writer harness runs: the full workspace build, then the web vite build.
 */
const ci = readFileSync(resolve(process.cwd(), '../../.github/workflows/ci.yml'), 'utf8');
const gates = readFileSync(resolve(process.cwd(), '../../scripts/freeze-gates.sh'), 'utf8');

function unitJob(): string {
  const start = ci.indexOf('  unit:');
  const end = ci.indexOf('  secrets-full-scan:');
  return ci.slice(start, end);
}

describe('CI build gates', () => {
  it('runs the workspace build and the web vite build from the unit job', () => {
    expect(unitJob()).toContain('bash scripts/freeze-gates.sh');
    expect(gates).toContain('pnpm -r build');
    expect(gates).toContain('pnpm --filter @bidstack/web build');
  });
});

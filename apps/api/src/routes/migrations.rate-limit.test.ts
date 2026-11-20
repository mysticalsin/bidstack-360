// WHY: the start-csv limiter used to keep a test-only generation counter and
// a NODE_ENV branch in the production key. A later request in the same
// process then shared or escaped the 10-per-minute bucket depending on which
// side of that branch it hit.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import * as migrationRoutes from './migrations.js';

describe('csv start rate-limit key', () => {
  it('keeps the production key free of test isolation', () => {
    const exported = Object.keys(migrationRoutes).filter((name) => name.endsWith('ForTests'));
    expect(exported).toEqual([]);

    const source = readFileSync(new URL('./migrations.ts', import.meta.url), 'utf8');
    const keyAt = source.indexOf('function csvStartRateKey');
    expect(keyAt).toBeGreaterThan(-1);
    const key = source.slice(keyAt, source.indexOf('\n}', keyAt));
    expect(key).not.toMatch(/NODE_ENV/);
    expect(key).toMatch(/u:\$\{auth\.orgId \?\? 'no-org'\}:\$\{auth\.userId\}/);
    expect(key).toMatch(/ip:\$\{req\.ip\}/);
  });
});

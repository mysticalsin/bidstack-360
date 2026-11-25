import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('fixture close stamps', () => {
  it('writes closedAt on seeded wins so revenue stays on the dated month', () => {
    // WHY: the close trigger stamps now() when a writer omits closedAt.
    // Historical wins and the April Aritzia win would then show as revenue
    // in the month the seed ran.
    const src = readFileSync(new URL('./seed.ts', import.meta.url), 'utf8');
    const fixture = src.slice(src.indexOf('for (const o of fixtureOpps)'), src.indexOf('console.log(`  ✓ opps:'));
    const history = src.slice(src.indexOf('for (const h of fixtureClosedDeals)'), src.indexOf('historical closed deals'));
    expect(fixture).toContain('closedAt');
    expect(history).toContain('closedAt,');
  });
});

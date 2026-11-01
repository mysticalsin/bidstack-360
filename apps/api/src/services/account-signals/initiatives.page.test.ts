import { describe, expect, it } from 'vitest';

import { evidencePageCapped, readBoundedPages } from './initiatives';

describe('evidencePageCapped', () => {
  it('names a full news or meeting page only when another row exists', () => {
    // WHY: the latest 100 items were read as every initiative signal from the year.
    expect(evidencePageCapped(100, 101, 2, 2)).toBe(true);
    expect(evidencePageCapped(3, 3, 100, 140)).toBe(true);
    expect(evidencePageCapped(100, 100, 100, 100)).toBe(false);
    expect(evidencePageCapped(4, 4, 1, 1)).toBe(false);
  });

  it('keeps a solution that sits past the first page', async () => {
    // WHY: take 100 marked a later Cloud practice as unsold.
    const result = await readBoundedPages(async (cursor) => {
      if (!cursor) return Array.from({ length: 1000 }, (_, index) => ({ id: `a${index}`, name: 'other' }));
      return [{ id: 'late', name: 'Cloud practice' }];
    }, 1000, 5000);
    expect(result.capped).toBe(false);
    expect(result.rows.at(-1)?.name).toBe('Cloud practice');
  });

  it('stops a solution read that never ends', async () => {
    const result = await readBoundedPages(async () => [{ id: 'x', name: 'loop' }, ...Array.from({ length: 999 }, (_, index) => ({ id: `b${index}`, name: 'other' }))], 1000, 2000);
    expect(result.capped).toBe(true);
    expect(result.rows.length).toBeGreaterThanOrEqual(2000);
  });
});

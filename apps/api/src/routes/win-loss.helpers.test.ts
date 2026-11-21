import { describe, expect, it } from 'vitest';

import { readAllPages, winRatePct } from './win-loss.helpers.js';

describe('win rate boundaries', () => {
  it('is null for an empty book, 100 for one win, and 0 for a closed-only loss', () => {
    expect(winRatePct(0, 0)).toBeNull();
    expect(winRatePct(1, 0)).toBe(100);
    expect(winRatePct(0, 1)).toBe(0);
  });

  it('keeps one decimal so 1 of 3 is 33.3 and 2 of 3 is 66.7', () => {
    expect(winRatePct(1, 2)).toBe(33.3);
    expect(winRatePct(2, 1)).toBe(66.7);
  });

  it('stays inside 0 to 100 for every small book', () => {
    for (let won = 0; won <= 20; won += 1) {
      for (let lost = 0; lost <= 20; lost += 1) {
        const rate = winRatePct(won, lost);
        if (won + lost === 0) {
          expect(rate).toBeNull();
          continue;
        }
        expect(rate).toBeGreaterThanOrEqual(0);
        expect(rate).toBeLessThanOrEqual(100);
        expect(rate! * 10).toBe(Math.round(rate! * 10));
      }
    }
  });
});

describe('readAllPages', () => {
  it('keeps the record past the 1000-row page', async () => {
    // WHY: /win-loss/analysis used one take:1000 and reported that page as the
    // book. /win-loss/patterns counted every row. The 1001st loss has to be in
    // the win rate or the two screens disagree.
    const calls: Array<string | undefined> = [];
    const rows = await readAllPages(1000, async (cursor) => {
      calls.push(cursor);
      if (cursor === undefined) {
        return Array.from({ length: 1000 }, (_, i) => ({ id: `p0-${i}` }));
      }
      return [{ id: 'p1-0' }];
    });
    expect(calls).toEqual([undefined, 'p0-999']);
    expect(rows).toHaveLength(1001);
    expect(rows[1000]?.id).toBe('p1-0');
  });

  it('stops when a page repeats its cursor', async () => {
    const rows = await readAllPages(1, async () => [{ id: 'same' }]);
    expect(rows.map((row) => row.id)).toEqual(['same']);
  });
});

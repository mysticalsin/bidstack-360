import { describe, expect, it } from 'vitest';

import { mergeLatestActivity } from './summary.js';

describe('mergeLatestActivity', () => {
  it('keeps a newer opportunity past the first five of another type', () => {
    // WHY: each source used to stop at five. A sixth opportunity, newer than
    // every task, dropped out of a 20-row feed.
    const opportunities = [6, 5, 4, 3, 2, 1].map((n) => ({
      date: `2026-06-${String(n).padStart(2, '0')}T00:00:00.000Z`,
      title: `opp-${n}`,
    }));
    const tasks = [1, 2, 3].map((n) => ({
      date: `2026-01-0${n}T00:00:00.000Z`,
      title: `task-${n}`,
    }));
    const latest = mergeLatestActivity([opportunities, tasks], 6);
    expect(latest.map((row) => row.title)).toEqual([
      'opp-6',
      'opp-5',
      'opp-4',
      'opp-3',
      'opp-2',
      'opp-1',
    ]);
  });
});

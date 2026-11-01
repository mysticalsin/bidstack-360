import { describe, expect, it } from 'vitest';

import { hiringSpikeWeeks } from './hiring-spike';

describe('hiringSpikeWeeks', () => {
  it('counts unread weeks as quiet only when the job-post page is complete', () => {
    // WHY: a newest-1,000 page never saw the other weeks. Calling them 0
    // drops the median, and a normal week of 6 reads as a spike.
    const oneBusyWeek = new Map<number, number>([[10, 6]]);
    expect(hiringSpikeWeeks(oneBusyWeek, 365, false)).toEqual([{ week: 10, count: 6, median: 0 }]);
    expect(hiringSpikeWeeks(oneBusyWeek, 365, true)).toEqual([]);
  });

  it('still flags a week that is twice the weeks that were actually read', () => {
    // WHY: the cap only drops invented zeros. A real jump inside the page stays.
    const weeks = new Map<number, number>([
      [1, 2],
      [2, 2],
      [3, 20],
    ]);
    expect(hiringSpikeWeeks(weeks, 365, true)).toEqual([{ week: 3, count: 20, median: 2 }]);
  });
});

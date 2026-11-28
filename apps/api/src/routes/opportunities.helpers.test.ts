import { describe, expect, it } from 'vitest';

import { opportunityListFilters } from './opportunities.helpers.js';

const now = new Date('2026-11-25T18:00:00.000Z');
const startOfToday = new Date(Date.UTC(2026, 10, 25));

describe('opportunityListFilters', () => {
  it('keeps a won or lost bid out of the overdue list', () => {
    // WHY: demo close dates sit in April–September 2026. Aritzia is closed won
    // on 28 Apr and NOS is closed lost on 12 Apr. The Overdue chip and the
    // dashboard Needs you link are the same date window, so those decided bids
    // sit in the list with open bids that are actually late. Needs you counts
    // only open bids. The list has to match, or the click shows more rows than
    // the number the lead was sent to clear.
    const where = opportunityListFilters({ overdue: true }, now);
    expect(where.dueDate).toEqual({ lt: startOfToday });
    expect(where.stage).toEqual({ notIn: ['closed_won', 'closed_lost'] });
  });

  it('still narrows an explicit open stage inside the overdue window', () => {
    // WHY: stage and due can both be on (for example S2 Sent and Overdue).
    // The open-stage rule must not wipe the stage the lead picked.
    const where = opportunityListFilters({ overdue: true, stage: 's2_sent' }, now);
    expect(where.dueDate).toEqual({ lt: startOfToday });
    expect(where.AND).toEqual([
      { stage: 's2_sent' },
      { stage: { notIn: ['closed_won', 'closed_lost'] } },
    ]);
  });

  it('does not treat a decided bid inside the next 7 days as out of that window', () => {
    // WHY: Due ≤ 7d is a calendar window, not the open-overdue list. A stage
    // the lead picked still applies, including a decided stage.
    const where = opportunityListFilters({ dueWithinDays: 7, stage: 'closed_won' }, now);
    expect(where.stage).toBe('closed_won');
    expect(where.AND).toBeUndefined();
    expect(where.dueDate).toEqual({
      gte: startOfToday,
      lte: new Date(startOfToday.getTime() + 7 * 86_400_000),
    });
  });

  it('leaves the book unfiltered by stage when overdue is off', () => {
    const where = opportunityListFilters({}, now);
    expect(where).toEqual({});
  });
});

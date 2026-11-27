import { describe, expect, it } from 'vitest';

import { nearestDueDay } from './calendar-deadlines.nearest.js';

describe('nearestDueDay', () => {
  // WHY: the demo week contains neither date. Proposals land on the earlier
  // day (30 days out) and open bids on the later one (45 days out). The jump
  // has to open the proposal day, or the team pages past the first deadline.
  it('picks the earlier day when looking ahead of an empty week', () => {
    expect(nearestDueDay(['2027-01-09', '2026-12-25'], 'after')).toBe('2026-12-25');
  });

  // WHY: several overdue bids sit behind the week. The latest one is the week
  // the team just left. The oldest one is not a useful jump.
  it('picks the later day when looking behind an empty week', () => {
    expect(nearestDueDay(['2026-06-30', '2026-09-15'], 'before')).toBe('2026-09-15');
  });

  it('ignores blanks so an empty horizon stays empty', () => {
    expect(nearestDueDay([null, undefined, ''], 'after')).toBeNull();
    expect(nearestDueDay([], 'before')).toBeNull();
  });
});

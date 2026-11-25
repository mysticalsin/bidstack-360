import { describe, expect, it } from 'vitest';

import { activityLateDays } from './activity-late';

// The demo book closes in May–September 2026. On a later day the dashboard
// recent-activity feed still lists those open follow-ups and bids, and the
// only clock on the row is when the record was created. A created-at stamp
// is not a due date: the row has to say the work is already late, and it
// must not say that for a follow-up due today or a bid that is already won.
const NOW = new Date('2026-11-25T15:00:00.000Z');

describe('activityLateDays', () => {
  it('counts an open follow-up whose due date is a previous UTC day', () => {
    expect(
      activityLateDays({ type: 'task', subtitle: 'in_progress', dueDate: '2026-05-15' }, NOW),
    ).toBe(194);
  });

  it('keeps a follow-up due today off the late list for the whole UTC day', () => {
    expect(
      activityLateDays({ type: 'task', subtitle: 'open', dueDate: '2026-11-25' }, NOW),
    ).toBeNull();
  });

  it('does not call a finished follow-up late', () => {
    expect(
      activityLateDays({ type: 'task', subtitle: 'done', dueDate: '2026-05-15' }, NOW),
    ).toBeNull();
  });

  it('counts an open bid whose close date has passed', () => {
    expect(
      activityLateDays(
        { type: 'opportunity', subtitle: 's4_negotiation', dueDate: '2026-06-30' },
        NOW,
      ),
    ).toBe(148);
  });

  it('stops the clock once the bid is won or lost', () => {
    expect(
      activityLateDays({ type: 'opportunity', subtitle: 'closed_won', dueDate: '2026-04-28' }, NOW),
    ).toBeNull();
    expect(
      activityLateDays(
        { type: 'opportunity', subtitle: 'closed_lost', dueDate: '2026-04-12' },
        NOW,
      ),
    ).toBeNull();
  });

  it('ignores leads, cases, and rows with no due date', () => {
    expect(
      activityLateDays({ type: 'lead', subtitle: 'new', dueDate: '2026-05-15' }, NOW),
    ).toBeNull();
    expect(activityLateDays({ type: 'task', subtitle: 'open', dueDate: null }, NOW)).toBeNull();
    expect(activityLateDays({ type: 'opportunity', subtitle: 's1_ongoing' }, NOW)).toBeNull();
  });
});

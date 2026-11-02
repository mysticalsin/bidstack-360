import { describe, expect, it } from 'vitest';

import { activityDaysFromToday, activityWhen } from './activity-when';

const NOW = Date.parse('2026-11-01T15:00:00.000Z');

describe('activityDaysFromToday', () => {
  it('keeps an afternoon activity 30 UTC days out at 30, not 31', () => {
    // WHY: the activity feed chip is the day a person sees. Elapsed hours
    // from 15:00Z to 18:00Z thirty UTC dates later are not a 30-day label,
    // and the same span looking back read as 29 days ago.
    expect(activityDaysFromToday('2026-12-01T18:00:00.000Z', NOW)).toBe(30);
    expect(activityWhen('2026-12-01T18:00:00.000Z', NOW)).toBe('in 30 days');
    expect(activityDaysFromToday('2026-10-02T18:00:00.000Z', NOW)).toBe(-30);
    expect(activityWhen('2026-10-02T18:00:00.000Z', NOW)).toBe('30 days ago');
  });

  it('counts an activity earlier the same UTC day as today, not yesterday', () => {
    // WHY: the activity is still today. A count of elapsed hours from UTC
    // midnight returns -1 and the chip reads as yesterday.
    expect(activityDaysFromToday('2026-11-01T08:00:00.000Z', NOW)).toBe(0);
    expect(activityWhen('2026-11-01T08:00:00.000Z', NOW)).toBe('today');
    expect(activityWhen('2026-10-31T18:00:00.000Z', NOW)).toBe('yesterday');
  });
});

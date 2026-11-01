import { describe, expect, it } from 'vitest';

import { staleCalendarDays, staleCutoff } from './kam-reports.js';

describe('KAM stale days', () => {
  it('counts a late activity on the UTC date, not the clock', () => {
    // WHY: floor of the clock called this 14 days. The dates are 15 days apart.
    const now = Date.parse('2026-11-15T15:00:00.000Z');
    expect(staleCalendarDays(new Date('2026-10-31T20:00:00.000Z'), now)).toBe(15);
    expect(staleCalendarDays(new Date('2026-11-15T00:00:00.000Z'), now)).toBe(0);
  });

  it('includes an activity that is 14 UTC days old even after noon', () => {
    // WHY: the clock cutoff was 14 days before 15:00, so a 20:00 activity on that day was left out.
    const now = Date.parse('2026-11-15T15:00:00.000Z');
    const cutoff = staleCutoff(14, now);
    expect(cutoff.toISOString()).toBe('2026-11-02T00:00:00.000Z');
    const late = new Date('2026-11-01T20:00:00.000Z');
    expect(late.getTime() < cutoff.getTime()).toBe(true);
    expect(staleCalendarDays(late, now)).toBe(14);
    expect(new Date('2026-11-02T00:00:00.000Z').getTime() < cutoff.getTime()).toBe(false);
  });
});

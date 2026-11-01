import { describe, expect, it } from 'vitest';

import { staleCalendarDays } from './kam-reports.js';

describe('staleCalendarDays', () => {
  it('counts a late activity on the UTC date, not the clock', () => {
    // WHY: floor of the clock called this 14 days. The dates are 15 days apart.
    const now = Date.parse('2026-11-15T15:00:00.000Z');
    expect(staleCalendarDays(new Date('2026-10-31T20:00:00.000Z'), now)).toBe(15);
    expect(staleCalendarDays(new Date('2026-11-15T00:00:00.000Z'), now)).toBe(0);
  });
});

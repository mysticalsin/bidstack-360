import { describe, expect, it } from 'vitest';

import { daysUntil } from './days-until.js';

const NOW = new Date('2026-11-01T15:00:00.000Z');

describe('daysUntil', () => {
  it('keeps an afternoon renewal 30 UTC days out at 30, not 31', () => {
    // WHY: the agreements list shows this count ("in 30 days" / "soon").
    // Rounding elapsed time from UTC midnight turned 30 days plus 18 hours into 31
    // and pushed the row out of the 30-day urgency bucket.
    expect(daysUntil(new Date('2026-12-01T18:00:00.000Z'), NOW)).toBe(30);
  });

  it('counts a renewal earlier the same UTC day as today, not yesterday', () => {
    // WHY: the renewal is still today. Subtracting the clock and flooring
    // the elapsed hours returns -1 and reads as already past.
    expect(daysUntil(new Date('2026-11-01T08:00:00.000Z'), NOW)).toBe(0);
  });

  it('leaves day 91 and a date already past outside the 90-day window', () => {
    // WHY: the expiring strip keeps 0 through 90 only. Day 91 and yesterday
    // must not land in that window because of an afternoon timestamp.
    const day91 = daysUntil(new Date('2027-01-31T18:00:00.000Z'), NOW);
    const past = daysUntil(new Date('2026-10-31T18:00:00.000Z'), NOW);
    expect(day91).toBe(91);
    expect(past).toBe(-1);
    expect(day91 !== null && day91 >= 0 && day91 <= 90).toBe(false);
    expect(past !== null && past >= 0 && past <= 90).toBe(false);
  });
});

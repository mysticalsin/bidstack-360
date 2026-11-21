import { describe, expect, it } from 'vitest';

import { daysUntil, formatDate } from './format.js';

const DISPLAY: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };

function calendarLabel(year: number, month: number, day: number): string {
  return new Date(year, month - 1, day).toLocaleDateString('en-US', DISPLAY);
}

describe('formatDate date-only values', () => {
  it('prints the calendar day of a YYYY-MM-DD due date, not the previous local day', () => {
    // WHY: new Date('YYYY-MM-DD') is UTC midnight. West of UTC that instant is
    // still the previous evening, so a task due 2026-03-15 rendered as Mar 14.
    expect(formatDate('2026-03-15', 'en-US')).toBe(calendarLabel(2026, 3, 15));
  });

  it('keeps a real instant on the local day of that instant', () => {
    const instant = '2026-03-15T00:00:00.000Z';
    expect(formatDate(instant, 'en-US')).toBe(new Date(instant).toLocaleDateString('en-US', DISPLAY));
  });

  it('shows the shift the UTC parse causes when the zone is west of UTC', () => {
    const shifted = new Date('2026-03-15').toLocaleDateString('en-US', DISPLAY);
    const calendar = calendarLabel(2026, 3, 15);
    if (new Date('2026-06-15T12:00:00Z').getTimezoneOffset() <= 0) return;
    expect(shifted).not.toBe(calendar);
    expect(formatDate('2026-03-15', 'en-US')).toBe(calendar);
  });
});

describe('daysUntil date-only values', () => {
  it('counts a due date against the local calendar day, including late evening', () => {
    // 22:00 on the due date is still that day. UTC-midnight math rounds the
    // elapsed hours to -1 and calls the task overdue for most of its due day.
    const evening = new Date(2026, 2, 15, 22, 0, 0);
    expect(daysUntil('2026-03-15', evening)).toBe(0);
    expect(daysUntil('2026-03-16', evening)).toBe(1);
    expect(daysUntil('2026-03-14', evening)).toBe(-1);
  });

  it('still measures elapsed time for a timestamp', () => {
    const now = new Date('2026-06-15T15:00:00.000Z');
    const past = new Date(now.getTime() - 3 * 86_400_000).toISOString();
    expect(daysUntil(past, now)).toBe(-3);
  });
});

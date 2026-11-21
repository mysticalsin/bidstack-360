import { describe, expect, it } from 'vitest';

import { daysUntil, formatDate } from './format.js';
import { formatPlainDate, parsePlainDate } from './plain-date.js';

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

const BOUNDARIES = [
  '2026-01-31',
  '2026-03-31',
  '2026-04-30',
  '2026-12-31',
  '2027-01-01',
  '2024-02-29',
  '2024-03-01',
  '1900-02-28',
  '2000-02-29',
  // Brazil DST started at midnight on this day (clocks skipped 00:00).
  '2018-11-04',
  // Brazil's last DST ended on this day.
  '2019-02-17',
  // US spring-forward and fall-back in 2026.
  '2026-03-08',
  '2026-11-01',
];

describe('plain date round trip', () => {
  it('format(parse(d)) equals d for month ends, leap day, year ends, and DST-history dates', () => {
    for (const iso of BOUNDARIES) {
      const parsed = parsePlainDate(iso);
      expect(parsed, iso).not.toBeNull();
      expect(formatPlainDate(parsed!)).toBe(iso);
      const local = new Date(parsed!.year, parsed!.month - 1, parsed!.day);
      expect(local.getFullYear(), iso).toBe(parsed!.year);
      expect(local.getMonth() + 1, iso).toBe(parsed!.month);
      expect(local.getDate(), iso).toBe(parsed!.day);
      expect(formatDate(iso, 'en-US')).toBe(calendarLabel(parsed!.year, parsed!.month, parsed!.day));
    }
  });

  it('format(parse(d)) equals d for every valid civil date from 1900 through 2100', () => {
    for (let year = 1900; year <= 2100; year += 1) {
      for (let month = 1; month <= 12; month += 1) {
        for (let day = 1; day <= 31; day += 1) {
          const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const parsed = parsePlainDate(iso);
          if (!parsed) continue;
          expect(formatPlainDate(parsed)).toBe(iso);
        }
      }
    }
  });

  it('rejects days that are not on the calendar', () => {
    for (const iso of ['2026-02-29', '1900-02-29', '2026-04-31', '2026-00-10', '2026-13-01', '2026-01-00', '2026-1-01']) {
      expect(parsePlainDate(iso), iso).toBeNull();
    }
  });
});

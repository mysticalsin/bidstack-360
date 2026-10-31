import { describe, expect, it } from 'vitest';

import {
  dueReminders,
  msaReminderUrl,
  nearestCrossedReminderDay,
  reminderCopy,
} from './msa-reminders.helpers.js';

const NOW = new Date('2026-10-31T15:00:00Z');
const plus = (d: number) => new Date(Date.UTC(2026, 9, 31) + d * 86_400_000);

describe('nearestCrossedReminderDay', () => {
  it.each([
    [120, null],
    [91, null],
    [90, 90],
    [61, 90],
    [60, 60],
    [45, 60],
    [30, 30],
    [0, 30],
    [-1, null],
  ])('%i days left -> %s', (days, want) => {
    expect(nearestCrossedReminderDay(days)).toBe(want);
  });
});

describe('dueReminders', () => {
  it('no expiry, no reminders', () => {
    expect(dueReminders({ expiryDate: null, noticePeriodDays: 30 }, NOW)).toEqual([]);
  });

  it('fires only the nearest expiry boundary', () => {
    expect(dueReminders({ expiryDate: plus(40), noticePeriodDays: null }, NOW).map((r) => r.kind)).toEqual(['expiry-60']);
  });

  it('fires the notice reminder inside the 14-day lead', () => {
    const r = dueReminders({ expiryDate: plus(40), noticePeriodDays: 30 }, NOW);
    expect(r.map((x) => x.kind)).toEqual(['expiry-60', 'notice']);
    expect(r[1]!.daysLeft).toBe(10);
    expect(r[1]!.date.toISOString().slice(0, 10)).toBe('2026-11-10');
  });

  it('long notice periods fire before the 90-day window', () => {
    expect(dueReminders({ expiryDate: plus(190), noticePeriodDays: 180 }, NOW).map((r) => r.kind)).toEqual(['notice']);
  });

  it('a passed notice deadline does not fire', () => {
    expect(dueReminders({ expiryDate: plus(20), noticePeriodDays: 30 }, NOW).map((r) => r.kind)).toEqual(['expiry-30']);
  });
});

describe('copy and url', () => {
  it('url carries kind and term', () => {
    expect(msaReminderUrl('abc', 'expiry-30', plus(10))).toBe('/msa/abc?reminder=expiry-30&term=2026-11-10');
  });

  it('auto-renew wording, no em dashes', () => {
    const [r] = dueReminders({ expiryDate: plus(30), noticePeriodDays: null }, NOW);
    const c = reminderCopy({ title: 'Acme MSA', companyName: 'Acme', autoRenew: true }, r!);
    expect(c.title).toBe('MSA renewal in 30 days: Acme MSA');
    expect(c.body).toContain('renews automatically on 2026-11-30');
    expect(c.title + c.body).not.toMatch(/\u2014/);
  });
});

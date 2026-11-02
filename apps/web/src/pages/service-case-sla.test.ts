import { afterEach, describe, expect, it, vi } from 'vitest';

import { formatSlaDate, isSlaPastDue, slaCalendarDays } from './service-case-sla';

// 19:00 in America/Sao_Paulo on 1 Nov, still 1 Nov UTC.
const EVENING_UTC = new Date('2026-11-01T22:00:00Z');
// 23:00 in America/Sao_Paulo on 1 Nov, already 2 Nov UTC.
const AFTER_LOCAL_MIDNIGHT = new Date('2026-11-02T02:00:00Z');

describe('service case SLA calendar days', () => {
  it('keeps an SLA dated today from reading as past due at both clock edges', () => {
    // WHY: the case header turns the SLA rose once it is past due. Comparing
    // the deadline instant to now marks 2026-11-01 as past due at 22:00Z,
    // and marks 2026-11-02T00:00Z as past due two hours later. Local Sao
    // Paulo is still 1 Nov at 02:00Z, which must not be required for "today".
    expect(slaCalendarDays('2026-11-01T08:00:00.000Z', EVENING_UTC)).toBe(0);
    expect(isSlaPastDue('2026-11-01', EVENING_UTC)).toBe(false);
    expect(slaCalendarDays('2026-10-31T23:00:00.000Z', EVENING_UTC)).toBe(-1);
    expect(isSlaPastDue('2026-10-31', EVENING_UTC)).toBe(true);

    expect(slaCalendarDays('2026-11-02T00:00:00.000Z', AFTER_LOCAL_MIDNIGHT)).toBe(0);
    expect(isSlaPastDue('2026-11-02', AFTER_LOCAL_MIDNIGHT)).toBe(false);
    expect(slaCalendarDays('2026-11-01T22:00:00.000Z', AFTER_LOCAL_MIDNIGHT)).toBe(-1);
    expect(isSlaPastDue('2026-11-01', AFTER_LOCAL_MIDNIGHT)).toBe(true);

    const onTheUtcDay = '2026-11-02T02:00:00.000Z';
    const utcLabel = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC' }).format(
      new Date(onTheUtcDay),
    );
    const saoPauloLabel = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Sao_Paulo',
    }).format(new Date(onTheUtcDay));
    expect(utcLabel).toBe('11/2/2026');
    expect(saoPauloLabel).toBe('11/1/2026');
    const localeDate = vi.spyOn(Date.prototype, 'toLocaleDateString');
    expect(formatSlaDate(onTheUtcDay, 'en-US')).toBe(utcLabel);
    expect(localeDate).toHaveBeenCalledWith('en-US', { timeZone: 'UTC' });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

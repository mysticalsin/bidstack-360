import { describe, expect, it } from 'vitest';

import { formatStage, formatMoney, daysUntil, isLateDueDay } from './format.js';

describe('formatStage', () => {
  it('humanizes snake_case enum values for display', () => {
    expect(formatStage('closed_won')).toBe('Closed Won');
    expect(formatStage('s1_ongoing')).toBe('S1 Ongoing');
    expect(formatStage('in_progress')).toBe('In Progress');
  });
});

describe('formatMoney', () => {
  it('uses compact notation for sums >= 1M (so dashboard cards stay scannable)', () => {
    const out = formatMoney(1_240_000, 'EUR');
    expect(out).toMatch(/1\.24\s*M/);
  });

  it('uses zero-decimal notation under 1M', () => {
    const out = formatMoney(320_000, 'EUR');
    expect(out).toMatch(/320,000/);
  });
});

describe('daysUntil', () => {
  it('returns null for missing input (so callers can omit "due in" labels)', () => {
    expect(daysUntil(null)).toBeNull();
    expect(daysUntil(undefined)).toBeNull();
  });

  it('returns negative integer for past dates (overdue UX)', () => {
    const past = new Date(Date.now() - 3 * 86400 * 1000).toISOString();
    expect(daysUntil(past)).toBeLessThan(0);
  });
});

// A date-only due date is that calendar day in the viewer's zone. Rounded
// elapsed milliseconds call it overdue once the UTC clock passes noon,
// because Math.round(-0.5) is still 0 and Math.round(-0.625) is -1.
const DUE = '2026-11-20';
const utc = (iso: string) => new Date(`${iso}Z`);

describe('daysUntil — date-only local calendar days', () => {
  it.each([
    ['00:01', '2026-11-20T00:01:00'],
    ['11:59', '2026-11-20T11:59:00'],
    ['12:00', '2026-11-20T12:00:00'],
    ['15:00', '2026-11-20T15:00:00'],
    ['23:59', '2026-11-20T23:59:00'],
  ])('stays on today at %s local in UTC', (_label, clock) => {
    expect(daysUntil(DUE, utc(clock), 'UTC')).toBe(0);
  });

  it('counts yesterday as exactly -1 at 15:00, when rounded milliseconds say -2', () => {
    expect(daysUntil('2026-11-19', utc('2026-11-20T15:00:00'), 'UTC')).toBe(-1);
  });

  it('counts tomorrow as exactly 1', () => {
    expect(daysUntil('2026-11-21', utc('2026-11-20T15:00:00'), 'UTC')).toBe(1);
  });

  it('pins the late boundary at one day so `< -1` does not spare yesterday', () => {
    expect(isLateDueDay(-1)).toBe(true);
    expect(isLateDueDay(0)).toBe(false);
  });

  it('splits America/Sao_Paulo (UTC-3) from UTC when the local dates differ', () => {
    // 02:30 UTC is 23:30 the previous evening in Sao Paulo.
    const lateEveningThere = new Date('2026-11-21T02:30:00Z');
    expect(daysUntil(DUE, lateEveningThere, 'UTC')).toBe(-1);
    expect(daysUntil(DUE, lateEveningThere, 'America/Sao_Paulo')).toBe(0);

    // 01:30 UTC is 22:30 the previous evening in Sao Paulo.
    const previousEveningThere = new Date('2026-11-20T01:30:00Z');
    expect(daysUntil(DUE, previousEveningThere, 'UTC')).toBe(0);
    expect(daysUntil(DUE, previousEveningThere, 'America/Sao_Paulo')).toBe(1);
  });
});

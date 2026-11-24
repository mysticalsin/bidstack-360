import { describe, expect, it } from 'vitest';

import { formatStage, formatMoney, formatDate, daysUntil } from './format.js';

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

  it('keeps a YYYY-MM-DD due today at 0 after 12:00 UTC, including in America/Sao_Paulo', () => {
    // UTC midnight of a date-only string is the previous evening in Sao Paulo.
    // Rounding elapsed milliseconds marked that task overdue for the rest of
    // the UTC day. The calendar day is what the server stores.
    const now = new Date('2026-11-21T15:00:00.000Z');
    expect(daysUntil('2026-11-21', now)).toBe(0);
    expect(daysUntil('2026-11-20', now)).toBe(-1);
    const shifted = new Date('2026-11-21').toLocaleDateString('en-US', {
      timeZone: 'America/Sao_Paulo',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    expect(shifted).toBe('Nov 20, 2026');
    expect(formatDate('2026-11-21', 'en-US')).toBe('Nov 21, 2026');
  });
});

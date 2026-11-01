import { describe, expect, it } from 'vitest';

import {
  formatStage,
  formatMoney,
  formatMoneyMicros,
  formatUsdMicros,
  daysUntil,
} from './format.js';

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

describe('formatMoneyMicros', () => {
  it('prints a large recorded amount on the cent', () => {
    // WHY: Number(micros) / 1e6 moved this USD figure to the next cent.
    const formatted = formatMoneyMicros('8598204328457184962', 'USD', {
      compact: false,
      locale: 'en',
    });
    expect(formatted).toContain('457.18');
    expect(formatted).not.toContain('457.19');
  });

  it('compacts an ordinary amount and a unit count past the safe integer range', () => {
    // WHY: Number(units) is not the compact input once the unit count passes 2^53.
    expect(formatMoneyMicros(1_500_000_000_000n, 'USD', { locale: 'en' })).toBe('$1.5M');
    const units = 9_950_000_000_000_000n;
    expect(formatMoneyMicros(units * 1_000_000n, 'USD', { locale: 'en' })).toBe('$9950T');
  });
});

describe('formatUsdMicros', () => {
  it('keeps a sub-cent AI cost instead of printing zero', () => {
    // WHY: dividing by 1e6 and keeping 4 decimals turned 5 micros into $0.0000.
    expect(formatUsdMicros(5)).toBe('0.000005');
    expect(formatUsdMicros(5_000_000n)).toBe('5');
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

import { describe, expect, it } from 'vitest';

import {
  formatStage,
  formatMoney,
  formatMoneyMicros,
  formatConvertedMicros,
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

  it('compacts an exact amount under 1M', () => {
    expect(formatMoney(320_000, 'EUR', 'en')).toMatch(/320K/);
  });

  it('keeps a cent and does not compact an amount two digits would move', () => {
    // WHY: amounts under 1M dropped the cent, and 12,015,000 became 12.02M.
    const cents = formatMoney(320_000.5, 'EUR', 'en');
    expect(cents).toContain('320,000.50');
    expect(cents).not.toMatch(/320,000(?!\.)/);
    const moved = formatMoney(12_015_000, 'EUR', 'en');
    expect(moved).toContain('12,015,000');
    expect(moved).not.toContain('12.02');
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
    // WHY: one compact digit turned 7.86M into $7.9M.
    expect(formatMoneyMicros(7_860_000_000_000n, 'USD', { locale: 'en' })).toBe('$7.86M');
    const units = 9_950_000_000_000_000n;
    expect(formatMoneyMicros(units * 1_000_000n, 'USD', { locale: 'en' })).toBe('$9950T');
    // WHY: two compact digits turned 12,015,000 into $12.02M.
    const moved = formatMoneyMicros(12_015_000_000_000n, 'USD', { locale: 'en' });
    expect(moved).toContain('12,015,000');
    expect(moved).not.toContain('12.02');
  });
});

describe('formatConvertedMicros', () => {
  it('keeps a cent and does not compact an amount the two digits would move', () => {
    // WHY: currency format under 1M dropped the cent, and 12,015,000 became 12.02M.
    expect(formatConvertedMicros(457_180_000n, 'USD')).toContain('457.18');
    expect(formatConvertedMicros(457_180_000n, 'USD')).not.toMatch(/\$457(?!\.)/);
    expect(formatConvertedMicros(12_015_000_000_000n, 'USD')).toContain('12,015,000');
    expect(formatConvertedMicros(12_015_000_000_000n, 'USD')).not.toContain('12.02');
    expect(formatConvertedMicros(7_860_000_000_000n, 'USD')).toContain('7.86');
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

  it('keeps a due date of today at zero after midnight UTC', () => {
    // WHY: rounding the clock made today overdue in the afternoon and due today in the morning.
    const now = Date.parse('2026-11-01T15:00:00.000Z');
    expect(daysUntil('2026-11-01', now)).toBe(0);
    expect(daysUntil('2026-10-31', now)).toBe(-1);
    expect(daysUntil('2026-11-02T23:00:00.000Z', now)).toBe(1);
    expect(daysUntil('not-a-date', now)).toBeNull();
  });
});

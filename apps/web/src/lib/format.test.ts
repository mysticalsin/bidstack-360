import { describe, expect, it } from 'vitest';

import {
  formatStage,
  formatMoney,
  formatMoneyMicros,
  formatMoneyMicrosFull,
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

// Expected strings are literal so a renderer that drifts through Number cannot
// pass by agreeing with itself. Prisma money columns are BigInt (int8), whose
// ceiling 9223372036854775807 micros is ~9.2e12 units.
describe('formatMoneyMicros exact digits', () => {
  const full = (micros: string | bigint, currency: string, locale = 'en-US') =>
    formatMoneyMicros(micros, currency, { compact: false, locale });

  it('renders every whole unit of values past Number.MAX_SAFE_INTEGER units', () => {
    expect(full(9007199254740993000000n, 'EUR')).toBe('€9,007,199,254,740,993.00');
    expect(full(-9007199254740993000000n, 'EUR')).toBe('-€9,007,199,254,740,993.00');
    expect(full('9007199254740993000000', 'USD')).toBe('$9,007,199,254,740,993.00');
  });

  it('rounds cents from the exact micros at the int8 column ceiling', () => {
    expect(full(9223372036854775807n, 'EUR')).toBe('€9,223,372,036,854.78');
    expect(full(9223372036854774999n, 'EUR')).toBe('€9,223,372,036,854.77');
    expect(full(-9223372036854774999n, 'EUR')).toBe('-€9,223,372,036,854.77');
    expect(full(1099511627776004999n, 'EUR')).toBe('€1,099,511,627,776.00');
    expect(full(1099511627776005000n, 'EUR')).toBe('€1,099,511,627,776.01');
  });

  it('rounds half-cents away from zero and keeps sub-cent amounts', () => {
    expect(full(1_005_000n, 'EUR')).toBe('€1.01');
    expect(full(1_004_999n, 'EUR')).toBe('€1.00');
    expect(full(-1_005_000n, 'EUR')).toBe('-€1.01');
    expect(full(10_000n, 'EUR')).toBe('€0.01');
    expect(full(999_999n, 'EUR')).toBe('€1.00');
    expect(full(123_456_789n, 'USD')).toBe('$123.46');
  });

  it('renders zero without a sign', () => {
    expect(full(0n, 'EUR')).toBe('€0.00');
    expect(full('0', 'USD')).toBe('$0.00');
    expect(formatMoneyMicros(0, 'EUR', { locale: 'en-US' })).toBe('€0.00');
  });

  it('applies locale grouping, decimal marks and currency placement', () => {
    expect(full(-1234567890000n, 'EUR', 'fr-FR')).toBe('-1\u202f234\u202f567,89\u00a0€');
    expect(full(1234567890000n, 'BRL', 'pt-BR')).toBe('R$\u00a01.234.567,89');
    expect(full(-1234567000000n, 'SEK', 'sv-SE')).toBe('\u22121\u00a0234\u00a0567,00\u00a0kr');
    expect(full(1234567000000n, 'JPY')).toBe('¥1,234,567');
  });

  it('keeps compact display rounding for scannable cards', () => {
    expect(formatMoneyMicros(9007199254740993000000n, 'EUR', { locale: 'en-US' })).toBe(
      '€9007.2T',
    );
    expect(formatMoneyMicros(1_234_000_000n, 'USD', { locale: 'en-US' })).toBe('$1.2K');
    expect(formatMoneyMicros(999_990_000n, 'USD', { locale: 'en-US' })).toBe('$999.99');
    expect(formatMoneyMicros(1_000_000_000n, 'USD', { locale: 'en-US' })).toBe('$1K');
  });

  it('formatMoneyMicrosFull shows exact digits for huge values', () => {
    expect(formatMoneyMicrosFull(9007199254740993000000n, 'EUR', 'en-US')).toBe(
      '€9,007,199,254,740,993.00',
    );
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

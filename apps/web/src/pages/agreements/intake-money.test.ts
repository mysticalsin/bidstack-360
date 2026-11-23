import { describe, expect, it } from 'vitest';

import { formatExtractedMicros, formatExtractedRowList } from './IntakeReviewPage';

describe('formatExtractedMicros', () => {
  it('prints a large safe micros amount from the integer, not the float', () => {
    // WHY: dividing this micros value by 1e6 in JS prints 8,598,204,328.457.
    const micros = 8_598_204_328_457_184;
    expect(formatExtractedMicros(micros, 'usd')).toBe('8,598,204,328.46 USD');
    expect(formatExtractedMicros(micros, 'usd')).not.toContain('328.457');
  });

  it('does not invent a euro amount when the extract has no currency', () => {
    expect(formatExtractedMicros(850_500_000)).toBe('850.50 unspecified');
    expect(formatExtractedMicros(850_500_000, 'EUR')).toBe('850.50 EUR');
  });

  it('refuses a micros number that is not a safe integer', () => {
    expect(formatExtractedMicros(Number.MAX_SAFE_INTEGER + 2)).toBe('amount not readable');
  });

  it('prints a liability cap above about 9.007 billion units', () => {
    // WHY: 9,007,199,255 units is 9_007_199_255_000_000 micros. That float is an exact
    // integer, but it sits past Number.MAX_SAFE_INTEGER, so the review said
    // "amount not readable" for a cap a reader can still name.
    expect(formatExtractedMicros(9_007_199_255_000_000, 'EUR')).toBe('9,007,199,255 EUR');
    expect(formatExtractedMicros(10_000_000_000_000_000, 'EUR')).toBe('10,000,000,000 EUR');
    expect(formatExtractedMicros(10_000_000_000_500_000, 'USD')).toBe('10,000,000,000.50 USD');
  });

  it('rounds an exact half cent away from zero on both signs', () => {
    // WHY: half-up and half-down disagree only when the remainder is exactly 5_000 micros.
    expect(formatExtractedMicros(1_005_000, 'USD')).toBe('1.01 USD');
    expect(formatExtractedMicros(-1_005_000, 'USD')).toBe('-1.01 USD');
    expect(formatExtractedMicros(1_004_999, 'USD')).toBe('1 USD');
    expect(formatExtractedMicros(-1_004_999, 'USD')).toBe('-1 USD');
  });
});

describe('formatExtractedRowList', () => {
  it('uses one precision for every amount in one rate-card list', () => {
    // WHY: the review prints a rate card as one joined row. 1,200 beside 850.50 reads as two precisions.
    expect(formatExtractedRowList([
      { role: 'Senior Consultant', rateMicros: 1_200_000_000, currency: 'EUR', unit: 'day' },
      { role: 'Designer', rateMicros: 850_500_000, currency: 'EUR', unit: 'day' },
    ])).toBe('Senior Consultant: 1,200.00 EUR / day · Designer: 850.50 EUR / day');
  });

  it('keeps a whole-unit list bare, including a sub-cent that rounds away', () => {
    // WHY: microcopy drops .00 when every amount in the list is a whole unit after half-cent rounding.
    expect(formatExtractedRowList([
      { role: 'Senior Consultant', rateMicros: 850_000_000, currency: 'EUR', unit: 'day' },
      { role: 'Principal Consultant', rateMicros: 1_100_000_000, currency: 'EUR', unit: 'day' },
      { role: 'Analyst', rateMicros: 1_004_999, currency: 'USD', unit: 'day' },
    ])).toBe('Senior Consultant: 850 EUR / day · Principal Consultant: 1,100 EUR / day · Analyst: 1 USD / day');
  });

  it('grows .00 on a whole sibling when another rate rounds up to a cent', () => {
    // WHY: the shared precision is decided after half-cent rounding, on both signs.
    expect(formatExtractedRowList([
      { role: 'Analyst', rateMicros: 1_004_999, currency: 'USD', unit: 'hour' },
      { role: 'Reviewer', rateMicros: -1_005_000, currency: 'USD', unit: 'hour' },
    ])).toBe('Analyst: 1.00 USD / hour · Reviewer: -1.01 USD / hour');
  });

  it('shares precision without inventing a currency or a number for an unsafe integer', () => {
    // WHY: lining up cents must not turn a missing code into EUR or an unsafe micros value into digits.
    expect(formatExtractedRowList([
      { role: 'Ghost', rateMicros: Number.MAX_SAFE_INTEGER + 2, currency: 'EUR', unit: 'day' },
      { role: 'Senior Consultant', rateMicros: 1_200_000_000, currency: null, unit: 'day' },
      { role: 'Designer', rateMicros: 850_500_000, currency: 'EUR', unit: 'day' },
    ])).toBe('Ghost: amount not readable / day · Senior Consultant: 1,200.00 unspecified / day · Designer: 850.50 EUR / day');
  });

  it('still joins named rows that are not rates', () => {
    // WHY: affiliates use the same list printer and must not pick up a money suffix.
    expect(formatExtractedRowList([{ name: 'Northwind Labs' }, { name: 'Contoso Synthetic' }])).toBe('Northwind Labs · Contoso Synthetic');
  });
});

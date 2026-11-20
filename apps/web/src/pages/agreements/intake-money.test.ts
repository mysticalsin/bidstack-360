import { describe, expect, it } from 'vitest';

import { formatExtractedMicros } from './IntakeReviewPage';

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

  it('rounds an exact half cent away from zero on both signs', () => {
    // WHY: half-up and half-down disagree only when the remainder is exactly 5_000 micros.
    expect(formatExtractedMicros(1_005_000, 'USD')).toBe('1.01 USD');
    expect(formatExtractedMicros(-1_005_000, 'USD')).toBe('-1.01 USD');
    expect(formatExtractedMicros(1_004_999, 'USD')).toBe('1 USD');
    expect(formatExtractedMicros(-1_004_999, 'USD')).toBe('-1 USD');
  });
});

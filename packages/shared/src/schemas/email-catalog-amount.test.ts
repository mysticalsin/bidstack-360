import { describe, expect, it } from 'vitest';

import { emailCatalogAmount } from './email-catalog-amount.js';
import { PLACEHOLDER_CATALOG } from './email-template.js';

const UNITS_61520_MICROS = 61_520_000_000n;

function digits(text: string): string {
  return text.replace(/\D/g, '');
}

describe('email catalog sample under demo data', () => {
  it('does not price a synthetic bid of 61520 as euros', () => {
    // WHY: the token catalog sample labels the opportunity amount as euros.
    // The column does not store a currency. Demo synthetic data of 61520
    // units must not read as a euro baseline. The figure stays 61520 and
    // does not name EUR. Fractional cents stay exact.
    const text = emailCatalogAmount(UNITS_61520_MICROS);
    const sample = PLACEHOLDER_CATALOG.find((row) => row.token === 'opportunity.amount')?.sample;

    expect(text).not.toMatch(/EUR|€/);
    expect(digits(text)).toContain('61520');
    expect(sample).not.toMatch(/EUR|€/);
    expect(sample).toBe(emailCatalogAmount(120_000_000_000n));
  });

  it('does not invent a euro zero when the micros are not a safe integer', () => {
    // WHY: a value that is not an integer micros amount is not a price.
    // It must not fall through to an EUR zero.
    expect(emailCatalogAmount(Number.NaN)).toBe('Not a number');
    expect(emailCatalogAmount(1.5)).toBe('Not a number');
    expect(emailCatalogAmount('nope')).toBe('Not a number');
    expect(emailCatalogAmount(Number.NaN)).not.toMatch(/EUR|€/);
  });
});

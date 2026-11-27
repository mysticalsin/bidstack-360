import { describe, expect, it } from 'vitest';

import { emailOpportunityAmount } from './email-opportunity-amount.js';
import { emailTokenAmount } from './email-token-amount.js';

const UNITS_61520_MICROS = 61_520_000_000n;

function digits(text: string): string {
  return text.replace(/\D/g, '');
}

describe('email token under demo data', () => {
  it('does not price a synthetic bid of 61520 as euros', () => {
    // WHY: the email token labels valueMicros as EUR. The column does not
    // store a currency. Demo synthetic data sent 61520 units through that
    // label, so the token read as a euro baseline. The figure stays
    // 61520 and does not name EUR. Fractional cents stay exact.
    const text = emailOpportunityAmount(UNITS_61520_MICROS);

    expect(text).not.toMatch(/EUR|€/);
    expect(digits(text)).toContain('61520');
  });

  it('does not invent a euro zero when the micros are not a safe integer', () => {
    // WHY: a value that is not an integer micros amount is not a price.
    // It must not fall through to an EUR zero.
    expect(emailTokenAmount(Number.NaN)).toBe('Not a number');
    expect(emailTokenAmount(1.5)).toBe('Not a number');
    expect(emailTokenAmount('nope')).toBe('Not a number');
    expect(emailTokenAmount(Number.NaN)).not.toMatch(/EUR|€/);
  });
});

import { describe, expect, it } from 'vitest';

import { dustPushAmount } from './dust-push-amount.js';
import { serializeOpportunityToMarkdown } from './dust-push-markdown.js';

const UNITS_61520_MICROS = 61_520_000_000n;

function digits(text: string): string {
  return text.replace(/\D/g, '');
}

describe('dust auto-push under demo data', () => {
  it('does not price a synthetic bid of 61520 as euros', () => {
    // WHY: the auto-push copy labels valueMicros as EUR. The column does not
    // store a currency. Demo synthetic data sent 61520 units through that
    // label, so the document read as a euro baseline. The figure stays
    // 61520 and does not name EUR. Fractional cents stay exact.
    const text = serializeOpportunityToMarkdown({
      name: 'Plant Controls',
      code: 'OP-6152',
      customer: 'Example Industrial',
      stage: 's3_technical_iteration',
      valueMicros: UNITS_61520_MICROS,
      probability: 40,
      dueDate: null,
      industry: 'Manufacturing',
      intel: {},
    });

    expect(text).not.toMatch(/EUR|€/);
    expect(digits(text)).toContain('61520');
  });

  it('does not invent a euro zero when the micros are not a safe integer', () => {
    // WHY: a value that is not an integer micros amount is not a price.
    // It must not fall through to an EUR zero.
    expect(dustPushAmount(Number.NaN)).toBe('Not a number');
    expect(dustPushAmount(1.5)).toBe('Not a number');
    expect(dustPushAmount('nope')).toBe('Not a number');
    expect(dustPushAmount(Number.NaN)).not.toMatch(/EUR|€/);
  });
});

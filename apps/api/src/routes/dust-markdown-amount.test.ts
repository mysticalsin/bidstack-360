import { describe, expect, it, vi } from 'vitest';

import type { Opportunity } from '@bidstack/db';

// helpers.ts reads `config` at import time. The unit job has no DATABASE_URL
// (env validation throws). This suite only checks markdown money formatting.
vi.mock('../env.js', () => ({
  config: { API_RATE_LIMIT_MAX: 120 },
  getEnv: () => ({ API_RATE_LIMIT_MAX: 120 }),
}));

import { dustMarkdownAmount } from './dust-markdown-amount.js';
import { serializeOpportunityToMarkdown } from './dust-integration.helpers.js';

const UNITS_61520_MICROS = 61_520_000_000n;

function digits(text: string): string {
  return text.replace(/\D/g, '');
}

function stubOpp(valueMicros: bigint): Opportunity {
  return {
    name: 'Plant Controls',
    code: 'OP-6152',
    customer: 'Example Industrial',
    stage: 's3_technical_iteration',
    valueMicros,
    probability: 40,
    dueDate: null,
    industry: 'Manufacturing',
    intel: {},
  } as Opportunity;
}

describe('dust markdown under demo data', () => {
  it('does not price a synthetic bid of 61520 as euros', () => {
    // WHY: Dust markdown labels valueMicros as EUR. The column does not
    // store a currency. Demo synthetic data sent 61520 units through that
    // label, so the document read as a euro baseline. The figure stays
    // 61520 and does not name EUR. Fractional cents stay exact.
    const text = serializeOpportunityToMarkdown(stubOpp(UNITS_61520_MICROS));

    expect(text).not.toMatch(/EUR|€/);
    expect(digits(text)).toContain('61520');
  });

  it('does not invent a euro zero when the micros are not a safe integer', () => {
    // WHY: a value that is not an integer micros amount is not a price.
    // It must not fall through to an EUR zero.
    expect(dustMarkdownAmount(Number.NaN)).toBe('Not a number');
    expect(dustMarkdownAmount(1.5)).toBe('Not a number');
    expect(dustMarkdownAmount('nope')).toBe('Not a number');
    expect(dustMarkdownAmount(Number.NaN)).not.toMatch(/EUR|€/);
  });
});

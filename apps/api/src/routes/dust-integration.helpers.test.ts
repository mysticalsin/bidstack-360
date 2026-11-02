import { describe, expect, it } from 'vitest';

import type { Opportunity } from '@bidstack/db';

import { serializeOpportunityToMarkdown } from './dust-integration.helpers.js';

function stubOpp(valueMicros: bigint): Opportunity {
  return {
    name: 'Cliff deal',
    code: 'OP-9001',
    customer: 'Exact Bank',
    stage: 's2_sent',
    valueMicros,
    probability: 50,
    dueDate: null,
    industry: 'financial_services',
    intel: {},
  } as Opportunity;
}

describe('serializeOpportunityToMarkdown', () => {
  it('writes large values and fractional cents as exact decimals', () => {
    // WHY: Dust used Number(micros)/1e6.toString(), which changes digits
    // past the safe-integer cliff and can drop fractional cents.
    const large = 9_007_199_254_740_993n;
    expect((Number(large) / 1_000_000).toString()).not.toBe('9007199254.740993');
    expect(serializeOpportunityToMarkdown(stubOpp(large))).toContain(
      '**Value (EUR):** 9007199254.740993',
    );
    expect(serializeOpportunityToMarkdown(stubOpp(1_234_567n))).toContain(
      '**Value (EUR):** 1.234567',
    );
  });
});

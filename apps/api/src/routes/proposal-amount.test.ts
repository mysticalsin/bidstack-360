import { describe, expect, it } from 'vitest';

import { proposalOpportunityValueLine } from './proposal-amount.js';

describe('proposalOpportunityValueLine', () => {
  it('does not price a synthetic bid of 61520 as euros', () => {
    // WHY: the AI draft prompt copies the linked opportunity value. That
    // column has no currency. Prefixing a euro sign made 61520 units read
    // as a euro baseline inside the section the model drafts.
    const line = proposalOpportunityValueLine(61_520_000_000n);
    expect(line).not.toMatch(/EUR|€/);
    expect(line.replace(/\D/g, '')).toBe('61520');
    expect(line.startsWith('Value: ')).toBe(true);
  });

  it('leaves the value line blank when the bid has no amount', () => {
    // WHY: a missing amount and a stored zero are not prices. Filling either
    // with a currency figure would invent a commercial baseline.
    expect(proposalOpportunityValueLine(null)).toBe('');
    expect(proposalOpportunityValueLine(undefined)).toBe('');
    expect(proposalOpportunityValueLine(0n)).toBe('');
  });
});

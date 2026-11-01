import { describe, expect, it } from 'vitest';

import { formatOpportunityAmount } from './email-template-render.js';

describe('formatOpportunityAmount', () => {
  it('does not turn a country-less amount into euros', () => {
    // WHY: the email preview inferred EUR, or USD from a US country, even
    // though the opportunity row has no currency.
    expect(formatOpportunityAmount(2_000_000n)).toBe('2 unspecified');
    expect(formatOpportunityAmount(1_500_000_000n)).toBe('1,500 unspecified');
    expect(formatOpportunityAmount(0)).toBe('');
  });
});

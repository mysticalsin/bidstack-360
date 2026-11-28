import { describe, expect, it } from 'vitest';

import { industrySplitFromPage } from './industry-page-split';

describe('industrySplitFromPage', () => {
  it('sums only the rows on the page and keeps a blank industry', () => {
    // WHY: the territory query is the whole open book. A filtered page that
    // drops telecom must not keep telecom's value, and a bid with no industry
    // still belongs in the split (the SQL COALESCE calls that Unspecified).
    const split = industrySplitFromPage([
      { industry: 'financial_services', value: 320_000, probability: 35 },
      { industry: 'financial_services', value: 180_000, probability: 45 },
      { industry: null, value: 0.5, probability: 10 },
      { industry: '  ', value: 10, probability: 20 },
    ]);
    expect(split.totalOpportunities).toBe(4);
    expect(split.totalSegments).toBe(2);
    expect(split.items.map((item) => item.label)).toEqual(['financial_services', 'Unspecified']);
    expect(split.items[0]).toMatchObject({
      opportunityCount: 2,
      totalValueMicros: 500_000_000_000,
      avgProbability: 40,
    });
    expect(split.items[1]?.totalValueMicros).toBe(10_500_000);
    expect(split.totalValueMicros).toBe(500_010_500_000);
    expect(split.items.every((item) => item.ownerNames.length === 0)).toBe(true);
  });
});
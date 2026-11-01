import { describe, expect, it } from 'vitest';

import { parseAccountHealthScore, recordedAccountIntel } from './ai-assistant.deals.service.js';

describe('recorded account intel', () => {
  it('does not invent a health score or a play from deal counts', () => {
    // Why: the stub used to return 50, or a smoothed win rate, and then
    // suggest upsells. Those reads were not a model score.
    const intel = recordedAccountIntel({
      opportunityCount: 7,
      wonCount: 4,
      lostCount: 2,
      contactCount: 3,
    });
    expect(intel.healthScore).toBeNull();
    expect(intel.expansionOpportunities).toEqual([]);
    expect(intel.churnRisks).toEqual([]);
    expect(intel.summary).toContain('4 won');
    expect(intel.summary).toContain('2 lost');
    expect(intel.summary).toContain('No health score was produced');
  });

  it('keeps only a finite score from 0 to 100', () => {
    expect(parseAccountHealthScore(71.2)).toBe(71);
    expect(parseAccountHealthScore(0)).toBe(0);
    expect(parseAccountHealthScore(undefined)).toBeNull();
    expect(parseAccountHealthScore(50.5)).toBe(51);
    expect(parseAccountHealthScore(Number.NaN)).toBeNull();
    expect(parseAccountHealthScore(120)).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';

import {
  parseAccountHealthScore,
  parseDealSentimentLabel,
  parseDealSentimentScore,
  recordedAccountIntel,
  recordedDealSentiment,
} from './ai-assistant.deals.service.js';

describe('recorded deal sentiment', () => {
  it('does not turn an activity count into a sentiment score', () => {
    // Why: zero activities used to score -0.2 and "negative", and five
    // activities used to score +0.3. A count is not a feeling.
    const none = recordedDealSentiment(0);
    const many = recordedDealSentiment(5);
    expect(none.score).toBeNull();
    expect(none.label).toBeNull();
    expect(none.riskFlags).toEqual([]);
    expect(none.suggestedActions).toEqual([]);
    expect(none.summary).toContain('0 activities recorded');
    expect(many.summary).toContain('5 activities recorded');
    expect(many.score).toBeNull();
  });

  it('keeps a model score only inside -1 to 1 and a known label', () => {
    expect(parseDealSentimentScore(-0.2)).toBe(-0.2);
    expect(parseDealSentimentScore(2)).toBeNull();
    expect(parseDealSentimentScore(undefined)).toBeNull();
    expect(parseDealSentimentLabel('neutral')).toBe('neutral');
    expect(parseDealSentimentLabel('unknown')).toBeNull();
  });
});

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

import { describe, expect, it } from 'vitest';

import { openRiskHeadline, openRiskSparkLabel, severityBucketCounts } from './open-risk-headline';

describe('open risk headline', () => {
  it('does not count the six cards as the open-risk book', () => {
    // WHY: the heading and the severity bars used the visible cards. Ten open
    // critical risks read as one low risk.
    const headline = openRiskHeadline({
      risks: [{ status: 'open', severity: 'low' }],
      openRiskCount: 11,
      openRiskSeverity: { critical: 10, high: 0, medium: 0, low: 1 },
    });
    expect(headline.total).toBe(11);
    expect(headline.high).toBe(10);
    expect(headline.spark).toEqual([1, 0, 0, 10]);
    expect(
      severityBucketCounts([{ severity: 'low' }], { critical: 10, high: 1, medium: 0, low: 1 }),
    ).toEqual({ critical: 10, high: 1, medium: 0, low: 1 });
  });

  it('falls back to the cards when the register counts are absent', () => {
    // WHY: an older snapshot has no severity counts. The cards are then the only book.
    const headline = openRiskHeadline({
      risks: [
        { status: 'open', severity: 'high' },
        { status: 'mitigated', severity: 'critical' },
        { status: 'accepted', severity: 'critical' },
      ],
    });
    // WHY: accepted is a recorded decision. It is not an open critical risk.
    expect(headline.total).toBe(1);
    expect(headline.high).toBe(1);
    expect(headline.spark).toEqual([0, 0, 1, 0]);
    expect(headline.unranked).toBe(0);
  });

  it('keeps an open risk with no rank in the mix', () => {
    // WHY: the total counted every open row and the bars only counted four
    // ranks. Three unranked risks read as a mix of zero.
    const headline = openRiskHeadline({
      risks: [{ status: 'open', severity: null }],
      openRiskCount: 5,
      openRiskSeverity: { critical: 2, high: 0, medium: 0, low: 0 },
    });
    expect(headline.total).toBe(5);
    expect(headline.unranked).toBe(3);
    expect(openRiskSparkLabel(headline)).toBe(
      'Open risks: 0 low, 0 medium, 0 high, 2 critical, 3 unranked',
    );
  });
});

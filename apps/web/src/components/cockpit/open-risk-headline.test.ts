import { describe, expect, it } from 'vitest';

import { openRiskHeadline, severityBucketCounts } from './open-risk-headline';

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
  });
});

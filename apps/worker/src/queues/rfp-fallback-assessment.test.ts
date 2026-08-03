// Regression tests for fusion Phase 6 — "unknown stops meaning bad".
//
// The old fallbacks wrote qaScoreBps=0 and responseStatus=PARTIAL/confidence=0
// when the AI provider was unavailable, making "the AI never ran" identical to
// "the AI scored this 0". Any analytics mean over those columns was silently
// dragged toward zero by rows that were never assessed. These tests pin the
// contract: a fallback returns NULL + UNAVAILABLE, and consumers must exclude
// (not zero-coerce) UNAVAILABLE rows from aggregates.
import { describe, expect, it } from 'vitest';

import { fallbackQa } from './rfp-qa-review.js';
import { fallbackCompliance } from './rfp-compliance-fill.js';

describe('fallbackQa — unknown is not a 0 score', () => {
  it('returns a null score with assessmentStatus UNAVAILABLE (regression: was 0)', () => {
    const result = fallbackQa();
    expect(result.scoreBps).toBeNull();
    expect(result.assessmentStatus).toBe('UNAVAILABLE');
  });

  it('still surfaces the manual-review issue for the approval UI', () => {
    const result = fallbackQa();
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.description).toMatch(/manual review/i);
  });
});

describe('fallbackCompliance — unknown is not PARTIAL', () => {
  it('carries no verdict and a null confidence (regression: was PARTIAL / 0)', () => {
    const result = fallbackCompliance();
    expect(result.assessmentStatus).toBe('UNAVAILABLE');
    // The discriminated union makes a verdict unrepresentable on the fallback
    // branch; assert at runtime too so a refactor cannot smuggle one back in.
    expect('verdict' in result).toBe(false);
    if (result.assessmentStatus === 'UNAVAILABLE') {
      expect(result.confidence).toBeNull();
    }
  });
});

describe('analytics aggregation over UNAVAILABLE rows', () => {
  // The aggregation contract every consumer must follow: exclude null scores
  // (SQL AVG() does this natively; JS consumers must filter).
  const meanOfAssessed = (scores: Array<number | null>): number | null => {
    const assessed = scores.filter((s): s is number => s !== null);
    if (assessed.length === 0) return null;
    return assessed.reduce((sum, s) => sum + s, 0) / assessed.length;
  };

  it('a mean is not dragged toward zero by UNAVAILABLE rows', () => {
    // Two real assessments plus one fallback row, exactly as the QA worker
    // persists them.
    const scores = [9000, 8000, fallbackQa().scoreBps];

    expect(meanOfAssessed(scores)).toBe(8500);

    // The pre-Phase-6 bug: coercing the unavailable row to 0 dragged the mean
    // down by a third. Pin that this is NOT what the contract produces.
    const zeroCoercedMean = scores.map((s) => s ?? 0).reduce((a, b) => a + b, 0) / scores.length;
    expect(zeroCoercedMean).toBeCloseTo(5666.67, 1);
    expect(meanOfAssessed(scores)).not.toBe(zeroCoercedMean);
  });

  it('a set of only UNAVAILABLE rows has no mean at all — not a 0% mean', () => {
    expect(meanOfAssessed([fallbackQa().scoreBps, fallbackQa().scoreBps])).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';

import {
  BID_CRITERIA,
  BID_THRESHOLDS,
  BID_TOTAL_WEIGHT,
  bidCriterionLabel,
  bidRecommendation,
  computeBidComposite,
} from './bid-criteria.js';
import { BidScoreCreate } from './bid-score.js';

describe('BID_CRITERIA registry', () => {
  it('weights sum to exactly 100 — anything else silently skews every composite', () => {
    const sum = BID_CRITERIA.reduce((acc, c) => acc + c.weight, 0);
    expect(sum).toBe(BID_TOTAL_WEIGHT);
    expect(sum).toBe(100);
  });

  it('contains all six brief-mandated criteria', () => {
    const ids = new Set(BID_CRITERIA.map((c) => c.id));
    for (const required of [
      'payment_terms',
      'deal_size',
      'resource_avail',
      'strategic_fit',
      'financial_risk',
      'competitive',
    ]) {
      expect(ids.has(required), `missing brief criterion: ${required}`).toBe(true);
    }
  });

  it('has unique ids — duplicates would double-count weight', () => {
    const ids = BID_CRITERIA.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('computeBidComposite', () => {
  it('divides by the FULL weight even when partially rated — the live UI and the persisted total must agree', () => {
    // Only strategic_fit (weight 14) rated at 5 → 14/100 = 14, never 100.
    const { totalScore } = computeBidComposite({ strategic_fit: 5 });
    expect(totalScore).toBe(14);
  });

  it('all 5s = 100, all 0s/empty = 0', () => {
    const full = Object.fromEntries(BID_CRITERIA.map((c) => [c.id, 5]));
    expect(computeBidComposite(full).totalScore).toBe(100);
    expect(computeBidComposite({}).totalScore).toBe(0);
  });

  it('ignores unknown criterion ids instead of crashing or counting them', () => {
    const withJunk = computeBidComposite({ strategic_fit: 5, legacy_or_junk: 5 });
    expect(withJunk.totalScore).toBe(14);
  });

  it('applies the single threshold table: bid ≥ 75, conditional ≥ 50, no_bid < 50', () => {
    expect(BID_THRESHOLDS).toEqual({ bid: 75, proceedWithCaution: 50 });
    expect(bidRecommendation(75)).toBe('bid');
    expect(bidRecommendation(74)).toBe('proceed_with_caution');
    // 50-54 used to render NO-BID in the UI but persist as conditional —
    // one table now, so 50 is conditional everywhere.
    expect(bidRecommendation(50)).toBe('proceed_with_caution');
    expect(bidRecommendation(49)).toBe('no_bid');
  });
});

describe('bidCriterionLabel read-tolerance', () => {
  it('labels legacy persisted ids instead of dropping them', () => {
    expect(bidCriterionLabel('margin_potential')).toContain('Margin Potential');
    expect(bidCriterionLabel('profitability')).toContain('Profitability');
    expect(bidCriterionLabel('fit')).toContain('Strategic Fit');
  });

  it('falls back to the raw id for unknown criteria — never undefined', () => {
    expect(bidCriterionLabel('totally_unknown')).toBe('totally_unknown');
  });
});

describe('BidScoreCreate override contract', () => {
  const base = {
    opportunityId: '00000000-0000-4000-8000-000000000001',
    criteria: { strategic_fit: 2 },
  };

  it('defaults decision to follow for legacy callers', () => {
    const parsed = BidScoreCreate.parse(base);
    expect(parsed.decision).toBe('follow');
  });

  it('rejects override justifications under 30 chars — the mandatory-note rule', () => {
    const short = {
      ...base,
      decision: 'override',
      override: { acknowledged: true, justification: 'too short' },
    };
    expect(() => BidScoreCreate.parse(short)).toThrow();
  });

  it('accepts an acknowledged override with a real justification', () => {
    const ok = {
      ...base,
      decision: 'override',
      override: {
        acknowledged: true,
        justification: 'Strategic account entry mandated by regional leadership for FY27.',
      },
    };
    expect(() => BidScoreCreate.parse(ok)).not.toThrow();
  });
});

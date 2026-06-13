// UI types, display constants, and pure helpers for the Bid/No-Bid matrix.
// The criteria registry, weights, composite math, and recommendation
// thresholds live in @bidstack/shared (bid-criteria.ts) — the API consumes
// the same module, so the live UI total can never diverge from the
// persisted one again.
import {
  BID_CRITERIA,
  BID_THRESHOLDS,
  bidRecommendation,
  type BidCriterionDef,
} from '@bidstack/shared';

export type Criterion = BidCriterionDef;

export const CRITERIA: readonly Criterion[] = BID_CRITERIA;

export type ScoreValue = 0 | 1 | 2 | 3 | 4 | 5;
export type Scores = Record<string, ScoreValue>;

export const SCORE_LABELS: Record<ScoreValue, string> = {
  0: 'Not rated',
  1: 'Very Weak',
  2: 'Weak',
  3: 'Neutral',
  4: 'Strong',
  5: 'Very Strong',
};

export const SCORE_COLORS: Record<ScoreValue, string> = {
  0: 'var(--fg-muted)',
  1: 'var(--danger)',
  2: 'var(--warning)',
  3: 'var(--fg-secondary)',
  4: 'var(--success)',
  5: 'var(--brand-primary)',
};

export const CATEGORY_INFO: Record<string, { label: string; color: string }> = {
  strategic: { label: 'Strategic Alignment', color: 'var(--brand-primary)' },
  technical: { label: 'Technical Readiness', color: 'var(--info)' },
  commercial: { label: 'Commercial Viability', color: 'var(--success)' },
  risk: { label: 'Risk Assessment', color: 'var(--warning)' },
};

export function getRecommendation(score: number): {
  verdict: string;
  color: string;
  status: 'success' | 'warning' | 'danger';
} {
  const rec = bidRecommendation(score);
  if (rec === 'bid') {
    return { verdict: 'BID — Strong fit', color: 'var(--success)', status: 'success' };
  }
  if (rec === 'proceed_with_caution') {
    return {
      verdict: 'CONDITIONAL BID — Review risks',
      color: 'var(--warning)',
      status: 'warning',
    };
  }
  return { verdict: 'NO-BID — Insufficient alignment', color: 'var(--danger)', status: 'danger' };
}

export { BID_THRESHOLDS };

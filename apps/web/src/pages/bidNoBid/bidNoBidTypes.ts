// UI types, display constants, and pure helpers for the Bid/No-Bid matrix.
// The criteria registry, weights, composite math, and recommendation
// thresholds live in @bidstack/shared (bid-criteria.ts) — the API consumes
// the same module, so the live UI total can never diverge from the
// persisted one again.
import {
  BID_CRITERIA,
  BID_THRESHOLDS,
  bidRecommendation,
  type BidCriterionCategory,
  type BidCriterionDef,
} from '@bidstack/shared';

import { ALL_SEGMENT } from '@/lib/table/list-search-params';

import type { CriteriaSortId } from './bid-no-bid-search-params';

export type Criterion = BidCriterionDef;

export const CRITERIA: readonly Criterion[] = BID_CRITERIA;

export type ScoreValue = 0 | 1 | 2 | 3 | 4 | 5;
export type Scores = Record<string, ScoreValue>;

/** The five ratings a criterion can carry, in ascending order. */
export const RATING_VALUES: readonly Exclude<ScoreValue, 0>[] = [1, 2, 3, 4, 5];

type Phrase = { key: string; fallback: string };

/**
 * Rating words, as translation keys rather than the English literals this file
 * used to hold. They are read by both the visible Rating column and the score
 * buttons' accessible names, so the two can never drift apart in a locale.
 */
export const RATING_LABEL: Record<ScoreValue, Phrase> = {
  0: { key: 'bidNoBid.rating.unrated', fallback: 'Not rated' },
  1: { key: 'bidNoBid.rating.veryWeak', fallback: 'Very weak' },
  2: { key: 'bidNoBid.rating.weak', fallback: 'Weak' },
  3: { key: 'bidNoBid.rating.neutral', fallback: 'Neutral' },
  4: { key: 'bidNoBid.rating.strong', fallback: 'Strong' },
  5: { key: 'bidNoBid.rating.veryStrong', fallback: 'Very strong' },
};

/**
 * Short category names for the table's Category column. Deliberately NOT the
 * same strings as CATEGORY_INFO's labels: those name the filter tabs, and one
 * word repeated in every row of a dense grid is noise, not information.
 */
export const CATEGORY_SHORT_LABEL: Record<BidCriterionCategory, Phrase> = {
  strategic: { key: 'bidNoBid.categoryShort.strategic', fallback: 'Strategic' },
  technical: { key: 'bidNoBid.categoryShort.technical', fallback: 'Technical' },
  commercial: { key: 'bidNoBid.categoryShort.commercial', fallback: 'Commercial' },
  risk: { key: 'bidNoBid.categoryShort.risk', fallback: 'Risk' },
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

/**
 * Weighted points a criterion currently contributes to the 0–100 composite.
 * Same arithmetic as computeBidComposite's per-criterion term (bid-criteria.ts)
 * — the shared module owns the total, this owns the per-row cell, and both
 * spell `(rating / 5) * weight` so a row can never disagree with the footer.
 */
export function contributionOf(criterion: Criterion, score: ScoreValue): number {
  return (score / 5) * criterion.weight;
}

function sortValue(criterion: Criterion, score: ScoreValue, sort: CriteriaSortId): number {
  if (sort === 'weight') return criterion.weight;
  if (sort === 'score') return score;
  if (sort === 'contribution') return contributionOf(criterion, score);
  return 0;
}

/**
 * The rows the table renders for a given URL state. Pure, so the same
 * `?category=&sort=&dir=` always produces the same list — which is what makes
 * the view shareable rather than merely bookmarkable.
 */
export function visibleCriteria({
  category,
  sort,
  dir,
  scores,
}: {
  category: string;
  sort: string;
  dir: 'asc' | 'desc';
  scores: Scores;
}): readonly Criterion[] {
  const filtered =
    !category || category === ALL_SEGMENT
      ? CRITERIA
      : CRITERIA.filter((criterion) => criterion.category === category);

  if (!sort) return filtered;

  const sign = dir === 'asc' ? 1 : -1;
  if (sort === 'criterion') {
    return [...filtered].sort((a, b) => sign * a.label.localeCompare(b.label));
  }

  const id = sort as CriteriaSortId;
  return [...filtered].sort(
    (a, b) =>
      sign *
        (sortValue(a, scores[a.id] ?? 0, id) - sortValue(b, scores[b.id] ?? 0, id)) ||
      // Ties break on the label so an unrated matrix (every score 0) still has
      // one deterministic order rather than whatever the engine felt like.
      a.label.localeCompare(b.label),
  );
}

export { BID_THRESHOLDS };

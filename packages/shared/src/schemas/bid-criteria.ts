// Bid/No-Bid criteria registry — SINGLE SOURCE OF TRUTH.
//
// History: the frontend (bidNoBidTypes.ts) and backend (bid-scores.ts) each
// kept their own diverging copy of this table (frontend: margin_potential /
// payment_terms / timeline_risk vs backend: profitability / timeline_fit /
// risk_profile), silently zeroing ~20 of 100 weight points on save. Both now
// consume this module.
//
// Mapping decisions (documented per M8 brief):
// - `fit` → `strategic_fit` (rename; brief criterion).
// - `margin_potential` (web) + `profitability` + `risk_profile` (api) fold
//   into `financial_risk` — one honest criterion covering margin erosion,
//   payment default, and cash-flow exposure. Rated 0–5 where 5 = strong
//   financial position / low risk, consistent with every other criterion.
// - `timeline_fit` (api) folds into `timeline_risk` (web id kept).
// - All six brief criteria present: payment_terms, deal_size, resource_avail,
//   strategic_fit, financial_risk, competitive.
// - Thresholds: the EXISTING BACKEND bands win (bid ≥ 75, proceed_with_caution
//   ≥ 50, no_bid < 50) so persisted recommendations stay consistent; the
//   frontend's stray 55 floor is retired.

export type BidCriterionCategory = 'strategic' | 'technical' | 'commercial' | 'risk';

export interface BidCriterionDef {
  id: string;
  label: string;
  description: string;
  category: BidCriterionCategory;
  /** Contribution to the 0–100 composite. All weights sum to exactly 100. */
  weight: number;
  /** Icon name in the web app's Icon registry (plain metadata here). */
  icon: string;
}

export const BID_CRITERIA: readonly BidCriterionDef[] = [
  {
    id: 'strategic_fit',
    label: 'Strategic Fit',
    description:
      'How well does this opportunity align with our core capabilities and strategic direction?',
    category: 'strategic',
    weight: 14,
    icon: 'target',
  },
  {
    id: 'relationship',
    label: 'Client Relationship',
    description:
      'Strength of existing relationship with the client. Prior wins, references, and decision-unit access.',
    category: 'strategic',
    weight: 8,
    icon: 'contacts',
  },
  {
    id: 'competitive',
    label: 'Competitive Landscape',
    description:
      'Our differentiation vs known competitors. Are we the incumbent? Do we have technical edge?',
    category: 'strategic',
    weight: 12,
    icon: 'trophy',
  },
  {
    id: 'tech_capability',
    label: 'Technical Capability',
    description: 'Do we have the people, technology, and certifications to deliver?',
    category: 'technical',
    weight: 12,
    icon: 'settings',
  },
  {
    id: 'resource_avail',
    label: 'Resources Available',
    description:
      'Are the required team members and subject-matter experts available for this timeline?',
    category: 'technical',
    weight: 10,
    icon: 'clock',
  },
  {
    id: 'solution_ready',
    label: 'Solution Readiness',
    description:
      'Level of maturity of our proposed solution. Proof-of-concept, prior delivery, or greenfield?',
    category: 'technical',
    weight: 8,
    icon: 'tasks',
  },
  {
    id: 'deal_size',
    label: 'Deal Size',
    description: 'Total contract value relative to our average deal size and revenue targets.',
    category: 'commercial',
    weight: 12,
    icon: 'dollar',
  },
  {
    id: 'payment_terms',
    label: 'Payment Terms',
    description: 'Acceptable payment schedule, milestones, and cash-flow impact.',
    category: 'commercial',
    weight: 8,
    icon: 'briefcase',
  },
  {
    id: 'financial_risk',
    label: 'Financial Risk',
    description:
      'Financial exposure: margin erosion after delivery costs, payment default risk, penalties, and provisions. 5 = strong position / low risk.',
    category: 'risk',
    weight: 10,
    icon: 'growth',
  },
  {
    id: 'timeline_risk',
    label: 'Timeline Risk',
    description:
      'Is the proposal deadline realistic? Can we produce a quality response? 5 = comfortable timeline.',
    category: 'risk',
    weight: 6,
    icon: 'warning',
  },
];

/** Composite divisor — ALWAYS the full registry weight, never the rated subset. */
export const BID_TOTAL_WEIGHT = 100;

/** ONE threshold table. bid ≥ 75, proceed_with_caution ≥ 50, no_bid < 50. */
export const BID_THRESHOLDS = { bid: 75, proceedWithCaution: 50 } as const;

export type BidRecommendationValue = 'bid' | 'proceed_with_caution' | 'no_bid';

export function bidRecommendation(totalScore: number): BidRecommendationValue {
  if (totalScore >= BID_THRESHOLDS.bid) return 'bid';
  if (totalScore >= BID_THRESHOLDS.proceedWithCaution) return 'proceed_with_caution';
  return 'no_bid';
}

export interface BidComposite {
  /** 0–100, weighted across the FULL registry weight (unrated criteria count as 0). */
  totalScore: number;
  /** 0–100 per category, weighted by the full category weight. */
  categoryScores: Record<string, number>;
  weightedSum: number;
  totalWeight: number;
  recommendation: BidRecommendationValue;
}

/**
 * Compute the composite from 0–5 ratings keyed by criterion id.
 * Unknown ids are ignored; missing/unrated criteria contribute 0 — the
 * divisor is always the full registry weight so live UI and persisted
 * totals can never diverge on partially rated matrices.
 */
export function computeBidComposite(ratings: Record<string, number>): BidComposite {
  const catMap: Record<string, { sum: number; weight: number }> = {};
  let weightedSum = 0;

  for (const criterion of BID_CRITERIA) {
    const raw = ratings[criterion.id] ?? 0;
    const rating = Math.min(5, Math.max(0, raw));
    const normalized = (rating / 5) * criterion.weight;
    weightedSum += normalized;

    const entry = catMap[criterion.category] ?? { sum: 0, weight: 0 };
    entry.sum += normalized;
    entry.weight += criterion.weight;
    catMap[criterion.category] = entry;
  }

  const totalScore = Math.round((weightedSum / BID_TOTAL_WEIGHT) * 100);
  const categoryScores: Record<string, number> = {};
  for (const [cat, data] of Object.entries(catMap)) {
    categoryScores[cat] = data.weight > 0 ? Math.round((data.sum / data.weight) * 100) : 0;
  }

  return {
    totalScore,
    categoryScores,
    weightedSum,
    totalWeight: BID_TOTAL_WEIGHT,
    recommendation: bidRecommendation(totalScore),
  };
}

/**
 * Labels for criterion ids that older persisted BidScore rows may contain
 * but that no longer exist in the registry. Read-tolerance: renderers must
 * show these with their stored value instead of crashing or hiding them.
 */
export const LEGACY_BID_CRITERION_LABELS: Record<string, string> = {
  fit: 'Strategic Fit (legacy)',
  margin_potential: 'Margin Potential (legacy)',
  profitability: 'Profitability (legacy)',
  timeline_fit: 'Timeline Fit (legacy)',
  risk_profile: 'Risk Profile (legacy)',
};

const CRITERIA_BY_ID = new Map(BID_CRITERIA.map((c) => [c.id, c]));

export function bidCriterionById(id: string): BidCriterionDef | undefined {
  return CRITERIA_BY_ID.get(id);
}

/** Label for any criterion id — registry first, legacy map second, raw id last. */
export function bidCriterionLabel(id: string): string {
  return CRITERIA_BY_ID.get(id)?.label ?? LEGACY_BID_CRITERION_LABELS[id] ?? id;
}

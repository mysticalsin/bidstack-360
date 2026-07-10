// Score/probability → chip tone for the predictive-scoring badges.
//
// WHY this exists: LeadScoreBadge and OppWinProbabilityBadge each carried a
// private copy of the same band→color mapping, written in raw Tailwind palette
// classes (bg-emerald-100 / text-red-800 + dark: mirrors). Raw palette classes
// don't follow the data-theme tokens, so the chips drifted from every other
// status chip (ProposalStatusChip, RequirementRow) and needed hand-maintained
// dark variants. This module is the one place that maps a score band to its
// tone, using the same token pairs as the rest of the chip system:
// jade tag = healthy, amber tag = watch, danger tint = at risk.

export type ScoreTone = 'healthy' | 'watch' | 'risk';

// Token pairs only (each resolves in light AND dark via index.css).
// Never raw Tailwind palette classes here — see scoreTone.test.ts.
export const SCORE_TONE_CLASSES: Record<ScoreTone, string> = {
  healthy: 'bg-[var(--tag-jade-bg)] text-[var(--tag-jade-fg)]',
  watch: 'bg-[var(--tag-amber-bg)] text-[var(--tag-amber-fg)]',
  risk: 'bg-[var(--danger-tint)] text-[var(--fg-error)]',
};

/** Lead score bands — must match the Hot (≥60) / Warm (≥40) / Cold labels. */
export function leadScoreTone(score: number): ScoreTone {
  if (score >= 60) return 'healthy';
  if (score >= 40) return 'watch';
  return 'risk';
}

/** Win-probability bands — must match Likely (≥70) / Possible (≥40) / At risk. */
export function oppWinProbabilityTone(probability: number): ScoreTone {
  if (probability >= 70) return 'healthy';
  if (probability >= 40) return 'watch';
  return 'risk';
}

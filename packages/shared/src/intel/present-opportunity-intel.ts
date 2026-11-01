import type { IntelPayload } from '../schemas/intel.js';

// The seed used to copy one fictional dossier onto every opportunity.
// Readers must drop that dossier so a deal does not show a 65% win
// prediction, a Series D, or Accenture/DXC as if they were measured.

const FIXTURE_WIN_MODEL = 'wp-baseline-0.1';
const FIXTURE_NEWS_HEADLINE = 'Customer announces digital transformation roadmap';
const FIXTURE_TRIGGER_LABELS = new Set([
  'Closed Series D — $80M',
  'New CTO appointed',
  'NIS2 deadline approaching',
]);

type Competitor = NonNullable<IntelPayload['competitors']>[number];
type Hiring = NonNullable<IntelPayload['hiring']>;
type Financial = NonNullable<IntelPayload['financial']>;

function isFixtureCompetitor(competitor: Competitor): boolean {
  const strengths = competitor.strengths.join('|');
  const weaknesses = competitor.weaknesses.join('|');
  if (
    competitor.vendor === 'Accenture' &&
    competitor.score === 72 &&
    strengths === 'Scale|Brand' &&
    weaknesses === 'Cost'
  ) {
    return true;
  }
  return (
    competitor.vendor === 'DXC' &&
    competitor.score === 64 &&
    strengths === 'Local presence' &&
    weaknesses === 'Tech depth'
  );
}

function isFixtureFinancial(financial: Financial | null | undefined): boolean {
  if (!financial) return false;
  return (
    financial.headcount === 2500 &&
    financial.revenueGrowth === 0.06 &&
    financial.ebitdaMargin === 0.32
  );
}

function isFixtureHiring(hiring: Hiring | null | undefined): boolean {
  if (!hiring) return false;
  return (
    hiring.velocity === 1.2 &&
    hiring.openings.length === 1 &&
    hiring.openings[0]?.title === 'VP Cloud Engineering'
  );
}

function asPayload(intel: unknown): IntelPayload {
  if (!intel || typeof intel !== 'object' || Array.isArray(intel)) return {};
  return intel as IntelPayload;
}

/**
 * Drop the copied seed dossier. A trigger, competitor, or win prediction
 * that does not match that dossier is kept.
 */
export function presentOpportunityIntel(intel: unknown): IntelPayload {
  const payload = asPayload(intel);
  const triggers = (payload.triggers ?? []).filter((trigger) => !FIXTURE_TRIGGER_LABELS.has(trigger.label));
  const news = (payload.news ?? []).filter((item) => item.headline !== FIXTURE_NEWS_HEADLINE);
  const competitors = (payload.competitors ?? []).filter((competitor) => !isFixtureCompetitor(competitor));
  const winPrediction =
    payload.winPrediction?.modelVersion === FIXTURE_WIN_MODEL ? undefined : payload.winPrediction;
  const financial = isFixtureFinancial(payload.financial) ? undefined : payload.financial ?? undefined;
  const hiring = isFixtureHiring(payload.hiring) ? undefined : payload.hiring ?? undefined;

  const next: IntelPayload = {
    ...payload,
    financial,
    winPrediction,
    hiring,
    triggers,
    competitors,
    news,
  };

  const hasRecordedIntel = Boolean(
    next.financial ||
      next.winPrediction ||
      next.hiring ||
      next.triggers?.length ||
      next.competitors?.length ||
      next.news?.length ||
      next.decisionUnit?.length,
  );
  if (!hasRecordedIntel) return {};
  return next;
}

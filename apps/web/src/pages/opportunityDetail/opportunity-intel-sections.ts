// Which opportunity-intel cards have a signal worth showing.
// An empty payload, or a financial object whose every field is null, is not
// a report. A measured zero is.
import type { IntelPayload } from '@bidstack/shared';

export interface OpportunityIntelSections {
  financial: boolean;
  winPrediction: boolean;
  triggers: boolean;
  competitors: boolean;
  news: boolean;
}

function hasText(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

export function opportunityIntelSections(
  intel: IntelPayload | null | undefined,
): OpportunityIntelSections {
  const financial = intel?.financial;
  const financialVisible = Boolean(
    financial &&
      (hasText(financial.ticker) ||
        financial.marketCap != null ||
        financial.revenueAnnual != null ||
        financial.revenueGrowth != null ||
        financial.ebitdaMargin != null ||
        hasText(financial.creditRating) ||
        financial.headcount != null ||
        financial.headcountTrend.length > 0 ||
        financial.pricePoints.length > 0),
  );
  return {
    financial: financialVisible,
    winPrediction: intel?.winPrediction != null,
    triggers: (intel?.triggers?.length ?? 0) > 0,
    competitors: (intel?.competitors?.length ?? 0) > 0,
    news: (intel?.news?.length ?? 0) > 0,
  };
}

/** True when something was stored or a refresh ran. Empty shells do not count. */
export function opportunityIntelHasRecord(intel: IntelPayload | null | undefined): boolean {
  if (!intel) return false;
  if (intel.refreshedAt) return true;
  const sections = opportunityIntelSections(intel);
  if (
    sections.financial ||
    sections.winPrediction ||
    sections.triggers ||
    sections.competitors ||
    sections.news
  ) {
    return true;
  }
  if ((intel.decisionUnit?.length ?? 0) > 0) return true;
  return (intel.hiring?.openings?.length ?? 0) > 0;
}

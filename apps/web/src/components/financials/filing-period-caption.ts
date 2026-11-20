import { FINANCIAL_PERIODS_DRAWN, filingPeriodPage } from '@bidstack/shared';

export { FINANCIAL_PERIODS_DRAWN, filingPeriodPage };

/**
 * Periods the financials list draws. The API drops the probe and sets
 * `periodsContinue`. A response that still carries that row is paged here
 * so the probe is not shown. A sample layout is not a truncated history.
 */
export function shownFilingPeriods<T>(
  periods: readonly T[],
  periodsContinue: boolean | undefined,
  sample: boolean,
): { periods: T[]; pageContinues: boolean } {
  if (sample) return { periods: [...periods], pageContinues: false };
  if (periods.length > FINANCIAL_PERIODS_DRAWN) return filingPeriodPage(periods);
  return { periods: [...periods], pageContinues: Boolean(periodsContinue) };
}

/**
 * Filing history line. A longer loaded list is the latest filings, not
 * every filing. A shorter list keeps "N years" (one year keeps no count).
 * No filing total is invented.
 */
export function filingPeriodCaption(count: number, pageContinues: boolean): string {
  if (pageContinues) {
    return `${FINANCIAL_PERIODS_DRAWN} in the latest ${FINANCIAL_PERIODS_DRAWN}, not every filing`;
  }
  if (count > 1) return `${count} years`;
  return '';
}

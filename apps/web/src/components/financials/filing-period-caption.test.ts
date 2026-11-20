import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { FINANCIAL_PERIODS_DRAWN } from '@bidstack/shared';

import { buildTiles } from './financials-format';
import {
  filingPeriodCaption,
  filingPeriodPage,
  shownFilingPeriods,
} from './filing-period-caption';

/**
 * Take the filings query actually uses. A literal 20 cuts the later period
 * before the caption can tell that the page is not the whole history.
 */
function financialPeriodQueryTake(src: string): number {
  const start = src.indexOf('export async function loadAccountFinancials');
  const fn = src.slice(start, src.indexOf('export const accountFinancialsRoutes'));
  if (fn.includes('take: financialPeriodTake()')) return FINANCIAL_PERIODS_DRAWN + 1;
  const match = fn.match(/financialPeriods:[\s\S]*?take:\s*(\d+)/);
  return match ? Number(match[1]) : 0;
}

function period(year: number, source: string) {
  return {
    periodType: 'FY' as const,
    fiscalYear: year,
    periodStart: `${year}-01-01`,
    periodEnd: `${year}-12-31`,
    currency: 'EUR',
    source,
    sourceUrl: `https://filings.example/${year}`,
    filedAt: null,
    metrics: { revenue: { valueMicros: '1823000000000000', concept: 'ifrs-full:Revenue' } },
    derived: { operatingMargin: null, netMargin: null, freeCashFlow: null },
  };
}

describe('filing period page', () => {
  it('does not call twenty periods the whole history when a later period was loaded', () => {
    // WHY: financials took twenty periods. Cutting a twenty-first left "20 years"
    // as if that page were every filing. One more loaded row means those twenty
    // are not every filing. The extra row is dropped. A shorter list keeps
    // "N years". No filing total is invented.
    const src = readFileSync(
      path.resolve(process.cwd(), '../api/src/routes/account-financials.ts'),
      'utf8',
    );
    const fn = src.slice(
      src.indexOf('export async function loadAccountFinancials'),
      src.indexOf('export const accountFinancialsRoutes'),
    );
    expect(fn).toContain('take: financialPeriodTake()');
    expect(fn).toContain('filingPeriodPage(');
    expect(fn).toContain('periodsContinue:');
    expect(fn).not.toMatch(/financialPeriods:[\s\S]*?take:\s*20/);

    const rows = Array.from({ length: FINANCIAL_PERIODS_DRAWN + 1 }, (_, n) =>
      period(2025 - n, n === FINANCIAL_PERIODS_DRAWN ? 'Probe Period' : `FY${2025 - n}`),
    );
    const loaded = rows.slice(0, financialPeriodQueryTake(src));
    const page = filingPeriodPage(loaded);
    const shown = shownFilingPeriods(page.periods, page.pageContinues, false);
    const caption = filingPeriodCaption(shown.periods.length, shown.pageContinues);
    expect(caption).toBe('20 in the latest 20, not every filing');
    expect(caption).not.toBe('20 years');
    expect(caption).not.toBe('20 periods');
    expect(caption).not.toBe('20 filings');
    expect(caption).not.toBe(`${rows.length} years`);
    expect(caption).not.toMatch(/21|Show all|View all/i);
    expect(shown.periods).toHaveLength(FINANCIAL_PERIODS_DRAWN);
    expect(shown.periods.some((row) => row.source === 'Probe Period')).toBe(false);
    expect(loaded.some((row) => row.source === 'Probe Period')).toBe(true);
    expect(shown.pageContinues).toBe(true);
    const revenue = buildTiles(shown.periods).find((tile) => tile.key === 'revenue');
    expect(revenue?.series).toHaveLength(FINANCIAL_PERIODS_DRAWN);
    expect(revenue?.series.some((point) => point.p.source === 'Probe Period')).toBe(false);

    const shortLoaded = rows.slice(0, 2).slice(0, financialPeriodQueryTake(src));
    const short = shownFilingPeriods(
      filingPeriodPage(shortLoaded).periods,
      filingPeriodPage(shortLoaded).pageContinues,
      false,
    );
    expect(short.pageContinues).toBe(false);
    expect(short.periods).toHaveLength(2);
    expect(filingPeriodCaption(short.periods.length, short.pageContinues)).toBe('2 years');
    expect(filingPeriodCaption(short.periods.length, short.pageContinues)).not.toMatch(/not every/i);
    expect(filingPeriodCaption(1, false)).toBe('');
    expect(filingPeriodCaption(FINANCIAL_PERIODS_DRAWN, false)).toBe('20 years');
    expect(shownFilingPeriods(short.periods, false, true).pageContinues).toBe(false);
  });
});

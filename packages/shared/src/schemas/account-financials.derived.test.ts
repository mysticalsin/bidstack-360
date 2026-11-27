import { describe, expect, it } from 'vitest';

import {
  builtInFinancialSample,
  marginPeriodsForMode,
  resolvePeriodDerived,
  isSampleFinancialSource,
  type FinancialPeriod,
} from './account-financials.js';

const period = (source: string, year: number): FinancialPeriod => ({
  periodType: 'FY',
  fiscalYear: year,
  periodStart: `${year}-01-01`,
  periodEnd: `${year}-12-31`,
  currency: 'NOK',
  source,
  sourceUrl: 'https://www.dnb.example/',
  filedAt: null,
  metrics: {
    revenue: { value: 85_300e6, concept: 'sample:Revenue' },
    operatingIncome: { value: 51_000e6, concept: 'sample:OperatingIncome' },
  },
  derived: { operatingMargin: null, netMargin: null, freeCashFlow: null },
});

describe('fixture filings without a stored margin', () => {
  it('derives 20 from operating income 20 on revenue 100, and null when revenue cannot divide', () => {
    // WHY: a fixture year stores revenue and operating income and no _derived.
    // Dividing by zero or a missing revenue must not become Infinity.
    expect(resolvePeriodDerived({
      revenue: { value: 100, concept: 'sample:Revenue' },
      operatingIncome: { value: 20, concept: 'sample:OperatingIncome' },
    }).operatingMargin).toBe(20);
    expect(resolvePeriodDerived({
      revenue: { value: 0, concept: 'sample:Revenue' },
      operatingIncome: { value: 20, concept: 'sample:OperatingIncome' },
    }).operatingMargin).toBeNull();
    expect(resolvePeriodDerived({
      operatingIncome: { value: 20, concept: 'sample:OperatingIncome' },
    }).operatingMargin).toBeNull();
    expect(resolvePeriodDerived({
      revenue: { value: 100, concept: 'sample:Revenue' },
    }).operatingMargin).toBeNull();
  });

  it('keeps a stored margin, and derives the DNB fixture year when none was stored', () => {
    // WHY: DNB's synthetic FY2025 is 51_000m operating income on 85_300m revenue.
    // The key-number tile only reads derived.operatingMargin, so the demo said
    // there was no margin. A filer-stored _derived still wins.
    expect(resolvePeriodDerived({
      revenue: { value: 85_300e6, concept: 'sample:Revenue' },
      operatingIncome: { value: 51_000e6, concept: 'sample:OperatingIncome' },
    }).operatingMargin).toBe(59.8);
    expect(resolvePeriodDerived({
      revenue: { value: 100, concept: 'ifrs-full:Revenue' },
      operatingIncome: { value: 10, concept: 'ifrs-full:ProfitLossFromOperatingActivities' },
      _derived: { operatingMargin: 16.5, netMargin: null, freeCashFlow: null },
    }).operatingMargin).toBe(16.5);
  });

  it('shows the built-in example only in demo, and drops fixture years from the real-mode margin', () => {
    // WHY: the example periods are fictional. Real mode must not paint them.
    // A fixture year can still sit in the database; the margin tile ignores it there.
    expect(builtInFinancialSample('demo', true, 0)).toBe(true);
    expect(builtInFinancialSample('real', true, 0)).toBe(false);
    expect(builtInFinancialSample('demo', false, 0)).toBe(false);
    expect(builtInFinancialSample('demo', true, 2)).toBe(false);
    const fixture = period('Sample data', 2025);
    const filed = { ...period('ESEF (filings.xbrl.org)', 2024), derived: { operatingMargin: 16.5, netMargin: null, freeCashFlow: null } };
    expect(marginPeriodsForMode([fixture], 'demo').map((p) => p.fiscalYear)).toEqual([2025]);
    expect(marginPeriodsForMode([fixture, filed], 'real').map((p) => p.source)).toEqual(['ESEF (filings.xbrl.org)']);
    expect(marginPeriodsForMode([fixture], 'real')).toEqual([]);
    expect(isSampleFinancialSource('Sample data')).toBe(true);
    expect(isSampleFinancialSource('ESEF (filings.xbrl.org)')).toBe(false);
  });
});

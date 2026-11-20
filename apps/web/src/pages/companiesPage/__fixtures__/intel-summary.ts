import type { CompanyIntelSummary } from '@bidstack/shared';

/** A filled summary as the list API returns it. */
export function intelSummary(over: Partial<CompanyIntelSummary> = {}): CompanyIntelSummary {
  return {
    companyId: '11111111-1111-1111-1111-111111111111',
    computedAt: '2026-11-07T10:00:00.000Z',
    revenue: { value: 2.4e9, source: 'esef', sourceLabel: 'ESEF (filings.xbrl.org)', asOf: '2026-11-06T10:00:00.000Z', method: 'Filed annual accounts', inferred: false, sample: false, currency: 'EUR', fiscalYear: 2025, range: null, approxUsd: 2.6e9 },
    revenueGrowth: { value: 14.3, source: 'esef', sourceLabel: 'ESEF (filings.xbrl.org)', asOf: '2026-11-06T10:00:00.000Z', method: 'Derived from FY2024 and FY2025 revenue', inferred: true, sample: false, fromYear: 2024, toYear: 2025 },
    headcount: { value: 12_000, source: 'apollo', sourceLabel: 'Apollo', asOf: '2026-11-05T10:00:00.000Z', method: 'Provider estimate', inferred: false, sample: false },
    headcountGrowth: { value: 6, source: 'apollo', sourceLabel: 'Apollo', asOf: '2026-11-05T10:00:00.000Z', method: 'Provider headcount growth over 6 months', inferred: false, sample: false, window: '6m' },
    openRoles: { value: 42, source: 'job_boards', sourceLabel: 'Greenhouse', asOf: '2026-11-06T10:00:00.000Z', method: 'Open postings on public job boards', inferred: false, sample: false },
    newRoles30d: { value: 12, source: 'job_boards', sourceLabel: 'Greenhouse', asOf: '2026-11-06T10:00:00.000Z', method: 'Postings first published in the last 30 days (hiring proxy)', inferred: false, sample: false, prev30: 8, trend30Pct: 50, trend90Pct: 20 },
    hiringTrend: { monthly: [3, 4, 6, 5, 8, 12], source: 'job_boards', sourceLabel: 'Greenhouse', asOf: '2026-11-06T10:00:00.000Z', sample: false },
    hiringMix: [{ key: 'data', label: 'Data', count: 14 }],
    topSkills: ['Python', 'Snowflake'],
    funding: { value: 250e6, source: 'apollo', sourceLabel: 'Apollo', asOf: '2026-11-05T10:00:00.000Z', method: 'Provider total funding', inferred: false, sample: false, latestRound: 'Series D', latestRoundAt: '2025-06-01T00:00:00.000Z' },
    foundedYear: 1998,
    industry: 'Banking',
    technologies: ['Snowflake'],
    departmentHeadcount: [],
    signal: { kind: 'acquisition', label: 'Acquisition', title: 'Acme buys Nordic payments firm', url: 'https://acme.example/news/1', publishedAt: '2026-10-20T00:00:00.000Z', sourceLabel: 'Company newsroom', sample: false },
    direction: { value: 'growing', reasons: ['Headcount up 6% in 6 months (Apollo)', '12 new postings in 30 days, up 50%'], inferred: true },
    gaps: {},
    sample: false,
    ...over,
  };
}

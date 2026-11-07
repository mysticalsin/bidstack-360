import { describe, expect, it } from 'vitest';

import {
  approxUsd,
  buildIntelSummary,
  CompanyIntelSummary,
  type IntelSummaryFirmographics,
  type IntelSummaryInput,
  type IntelSummaryPosting,
} from './summary.js';

const NOW = new Date('2026-11-07T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

function posting(i: number, postedDaysAgo: number, fn = 'data', over: Partial<IntelSummaryPosting> = {}): IntelSummaryPosting {
  return {
    id: `p${i}`,
    title: `Data Engineer ${i}`,
    function: fn,
    department: null,
    skills: ['Python'],
    postedAt: daysAgo(postedDaysAgo),
    lastSeenAt: daysAgo(1),
    source: 'greenhouse',
    url: `https://boards.greenhouse.io/acme/jobs/${i}`,
    sample: false,
    fetchedAt: daysAgo(1),
    ...over,
  };
}

function firmo(over: Partial<IntelSummaryFirmographics> = {}): IntelSummaryFirmographics {
  return {
    annualRevenueUsd: 4_000_000_000,
    revenueRange: '$1B-$10B',
    employeeCount: 12_000,
    headcountGrowth6m: 0.04,
    headcountGrowth12m: 0.09,
    totalFundingUsd: 250_000_000,
    latestFundingStage: 'Series D',
    latestFundingAt: '2025-06-01T00:00:00.000Z',
    foundedYear: 1998,
    industry: 'Banking',
    techStack: ['Snowflake'],
    departmentHeadcount: { engineering: 900, sales: 400 },
    provenance: { annualRevenueUsd: { source: 'apollo', fetchedAt: daysAgo(2) } },
    fetchedAt: daysAgo(2),
    ...over,
  };
}

function input(over: Partial<IntelSummaryInput> = {}): IntelSummaryInput {
  return {
    companyId: 'c1',
    now: NOW,
    years: [],
    postings: [],
    posts: [],
    firmographics: null,
    crm: { employeeCount: null, industry: null, updatedAt: null },
    connections: { publicSources: true, apollo: true },
    runs: {},
    ...over,
  };
}

describe('buildIntelSummary: revenue', () => {
  it('prefers filed revenue over the Apollo estimate and keeps fiscal year and currency', () => {
    const s = buildIntelSummary(
      input({
        firmographics: firmo(),
        years: [
          { fiscalYear: 2024, periodEnd: '2024-12-31', currency: 'USD', source: 'sec_edgar', revenue: 4.8e9, headcount: 11_000, fetchedAt: daysAgo(3) },
          { fiscalYear: 2025, periodEnd: '2025-12-31', currency: 'USD', source: 'sec_edgar', revenue: 5.2e9, headcount: 11_500, fetchedAt: daysAgo(3) },
        ],
      }),
    );
    expect(s.revenue).toMatchObject({ value: 5.2e9, source: 'sec_edgar', fiscalYear: 2025, currency: 'USD', inferred: false });
    expect(s.revenue?.sourceLabel).toBe('SEC EDGAR');
    // Growth is Polo arithmetic on two filed years, so it is inferred.
    expect(s.revenueGrowth).toMatchObject({ fromYear: 2024, toYear: 2025, inferred: true });
    expect(s.revenueGrowth?.value).toBeCloseTo(8.3, 1);
  });

  it('falls back to the Apollo revenue range, labelled as Apollo, with no fiscal year', () => {
    const s = buildIntelSummary(input({ firmographics: firmo() }));
    expect(s.revenue).toMatchObject({ value: 4e9, source: 'apollo', sourceLabel: 'Apollo', fiscalYear: null, range: '$1B-$10B' });
    expect(s.revenue?.method).toMatch(/estimate/i);
    expect(s.revenueGrowth).toBeNull();
  });

  it('keeps registry currency and marks the USD conversion as approximate', () => {
    const s = buildIntelSummary(
      input({ connections: { publicSources: true, apollo: false }, years: [{ fiscalYear: 2025, periodEnd: '2025-12-31', currency: 'NOK', source: 'brreg', revenue: 85_300e6, headcount: null, fetchedAt: daysAgo(5) }] }),
    );
    expect(s.revenue).toMatchObject({ currency: 'NOK', source: 'brreg', fiscalYear: 2025 });
    expect(s.revenue?.approxUsd).toBeGreaterThan(5e9);
    expect(approxUsd(100, 'USD')).toBe(100);
    expect(approxUsd(100, 'XYZ')).toBeNull();
  });
});

describe('buildIntelSummary: hiring', () => {
  it('counts new postings in the last 30 days as the hiring proxy and never claims hires', () => {
    const postings = [posting(1, 3), posting(2, 10), posting(3, 25, 'security'), posting(4, 40), posting(5, 70)];
    const s = buildIntelSummary(input({ postings }));
    expect(s.newRoles30d).toMatchObject({ value: 3, prev30: 1, source: 'job_boards', inferred: false });
    expect(s.newRoles30d?.method).toMatch(/hiring proxy/i);
    expect(s.newRoles30d?.method).not.toMatch(/\bhire[sd]?\b/i);
    expect(s.openRoles?.value).toBe(5);
    expect(s.openRoles?.sourceLabel).toBe('Greenhouse');
    expect(s.hiringTrend?.monthly).toHaveLength(6);
    expect(s.hiringMix[0]).toMatchObject({ key: 'data', label: 'Data' });
    expect(s.topSkills).toContain('Python');
  });

  it('takes headcount growth from Apollo 6 months, else filings year over year as inferred', () => {
    const apollo = buildIntelSummary(input({ firmographics: firmo() }));
    expect(apollo.headcountGrowth).toMatchObject({ window: '6m', source: 'apollo', inferred: false });
    expect(apollo.headcountGrowth?.value).toBeCloseTo(4);
    expect(apollo.headcount).toMatchObject({ value: 12_000, source: 'apollo' });

    const filings = buildIntelSummary(
      input({
        connections: { publicSources: true, apollo: false },
        years: [
          { fiscalYear: 2024, periodEnd: '2024-12-31', currency: 'EUR', source: 'esef', revenue: null, headcount: 1000, fetchedAt: null },
          { fiscalYear: 2025, periodEnd: '2025-12-31', currency: 'EUR', source: 'esef', revenue: null, headcount: 1100, fetchedAt: null },
        ],
      }),
    );
    expect(filings.headcountGrowth).toMatchObject({ window: '12m', source: 'esef', inferred: true });
    expect(filings.headcountGrowth?.value).toBeCloseTo(10);
    expect(filings.headcount).toMatchObject({ value: 1100, source: 'esef' });
  });

  it('uses the CRM employee count only as a labelled last resort', () => {
    const s = buildIntelSummary(input({ crm: { employeeCount: 450, industry: null, updatedAt: daysAgo(30) } }));
    expect(s.headcount).toMatchObject({ value: 450, source: 'crm', sourceLabel: 'CRM record' });
  });
});

describe('buildIntelSummary: empty values carry a reason', () => {
  it('says not connected when neither public sources nor Apollo are configured', () => {
    const s = buildIntelSummary(input({ connections: { publicSources: false, apollo: false } }));
    expect(s.revenue).toBeNull();
    expect(s.gaps.revenue?.reason).toBe('not_connected');
    expect(s.gaps.openRoles?.reason).toBe('not_connected');
    expect(s.gaps.funding?.reason).toBe('not_connected');
  });

  it('says private company when filings and registries ran and found no accounts', () => {
    const s = buildIntelSummary(
      input({ connections: { publicSources: true, apollo: false }, runs: { financials: { status: 'ok', lastFetchedAt: daysAgo(1) }, registry: { status: 'partial', lastFetchedAt: daysAgo(1) } } }),
    );
    expect(s.gaps.revenue?.reason).toBe('private_company');
  });

  it('says no public data when the job boards ran and found nothing', () => {
    const s = buildIntelSummary(input({ runs: { hiring: { status: 'partial', lastFetchedAt: daysAgo(1) } } }));
    expect(s.openRoles).toBeNull();
    expect(s.gaps.openRoles?.reason).toBe('no_public_data');
    expect(s.gaps.newRoles30d?.reason).toBe('no_public_data');
  });

  it('has a gap for every empty field and none for filled ones', () => {
    const s = buildIntelSummary(input({ firmographics: firmo(), postings: [posting(1, 2)] }));
    for (const f of ['revenue', 'headcount', 'headcountGrowth', 'openRoles', 'newRoles30d', 'funding'] as const) {
      expect(s[f], f).not.toBeNull();
      expect(s.gaps[f], f).toBeUndefined();
    }
    expect(s.gaps.signal?.reason).toBe('no_public_data');
  });
});

describe('buildIntelSummary: direction and signal', () => {
  it('reads growing from headcount growth and rising postings, with reasons, always inferred', () => {
    const postings = [posting(1, 2), posting(2, 5), posting(3, 9), posting(4, 12), posting(5, 45)];
    const s = buildIntelSummary(input({ firmographics: firmo(), postings }));
    expect(s.direction).toMatchObject({ value: 'growing', inferred: true });
    expect(s.direction?.reasons.join(' ')).toMatch(/headcount up 4%/i);
    expect(s.direction?.reasons.join(' ')).toMatch(/new postings/i);
  });

  it('reads contracting from shrinking headcount and a layoffs post', () => {
    const s = buildIntelSummary(
      input({
        firmographics: firmo({ headcountGrowth6m: -0.06 }),
        posts: [{ kind: 'layoffs', title: 'Acme to cut 800 roles', url: 'https://acme.example/news/1', publishedAt: daysAgo(20), sourceLabel: 'Company newsroom', sample: false }],
      }),
    );
    expect(s.direction?.value).toBe('contracting');
    expect(s.direction?.reasons.join(' ')).toMatch(/cut 800 roles/);
    expect(s.signal).toMatchObject({ kind: 'layoffs', label: 'Layoffs' });
  });

  it('has no direction and a gap when there is nothing to read', () => {
    const s = buildIntelSummary(input({ connections: { publicSources: true, apollo: true } }));
    expect(s.direction).toBeNull();
    expect(s.gaps.direction?.reason).toBe('no_public_data');
  });

  it('marks the summary sample when it is built from fixtures', () => {
    const s = buildIntelSummary(input({ postings: [posting(1, 2, 'data', { source: 'fixture', sample: true })] }));
    expect(s.sample).toBe(true);
    expect(s.openRoles?.sample).toBe(true);
    expect(s.openRoles?.sourceLabel).toBe('Sample data');
  });

  it('parses with the published contract', () => {
    const s = buildIntelSummary(input({ firmographics: firmo(), postings: [posting(1, 2)] }));
    expect(() => CompanyIntelSummary.parse(s)).not.toThrow();
  });
});

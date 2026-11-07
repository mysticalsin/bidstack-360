import { describe, expect, it } from 'vitest';

import {
  AccountDirection,
  buildDirection,
  buildInvestmentPlan,
  classifyPost,
  extractSkills,
  extractStatements,
  summarizeHiring,
  type FinancialYearInput,
  type HiringPostingInput,
  type IntelPost,
} from './index.js';

const NOW = new Date('2026-11-06T12:00:00Z');
const DAY = 86_400_000;
const ago = (d: number) => new Date(NOW.getTime() - d * DAY);

function posting(over: Partial<HiringPostingInput> & { id: string }): HiringPostingInput {
  return { title: 'Engineer', function: 'engineering', department: null, skills: [], postedAt: ago(5), lastSeenAt: ago(1), source: 'greenhouse', url: null, ...over };
}

function year(fy: number, metrics: Partial<FinancialYearInput>): FinancialYearInput {
  return {
    fiscalYear: fy,
    periodEnd: `${fy}-12-31`,
    currency: 'EUR',
    source: 'ESEF (filings.xbrl.org)',
    sourceUrl: `https://filings.xbrl.org/report-${fy}`,
    revenue: null,
    operatingMargin: null,
    netMargin: null,
    capex: null,
    rnd: null,
    acquisitions: null,
    intangibles: null,
    debtIssued: null,
    cash: null,
    debt: null,
    headcount: null,
    restructuring: null,
    sample: false,
    evidenceId: `fin:${fy}`,
    ...metrics,
  };
}

describe('skills keywords', () => {
  it('reads project signals from job text, not generic words', () => {
    expect(extractSkills('Senior SAP S/4HANA Finance Consultant')).toContain('SAP S/4HANA');
    expect(extractSkills('Salesforce Solution Architect')).toContain('Salesforce');
    expect(extractSkills('Data Platform Engineer (Databricks)')).toEqual(expect.arrayContaining(['Databricks', 'Data platform']));
    expect(extractSkills('Product Manager, Generative AI')).toContain('Generative AI');
    expect(extractSkills('Office manager')).toEqual([]);
  });
});

describe('hiring summary', () => {
  it('counts open roles, 30 and 90 day trends, function mix and skills', () => {
    const postings = [
      posting({ id: 'a', title: 'Data Engineer, Snowflake', function: 'data', skills: ['Snowflake'], postedAt: ago(3) }),
      posting({ id: 'b', title: 'Data Engineer', function: 'data', postedAt: ago(10) }),
      posting({ id: 'c', title: 'SAP S/4HANA lead', function: 'operations', skills: ['SAP S/4HANA'], postedAt: ago(45), lastSeenAt: ago(2) }),
      posting({ id: 'd', title: 'Old role', function: 'sales', postedAt: ago(120), lastSeenAt: ago(100) }),
    ];
    const s = summarizeHiring(postings, NOW);
    expect(s.openRoles).toBe(3);
    expect(s.posted30).toBe(2);
    expect(s.postedPrev30).toBe(1);
    expect(s.trend30Pct).toBe(100);
    expect(s.byFunction[0]).toMatchObject({ key: 'data', count: 2 });
    // Skills come from stored skills and from the title.
    expect(s.skills.map((k) => k.skill)).toEqual(expect.arrayContaining(['Snowflake', 'SAP S/4HANA']));
    expect(s.skills.find((k) => k.skill === 'SAP S/4HANA')?.theme).toBe('erp_finance');
    expect(s.monthly).toHaveLength(6);
  });

  it('returns null trends instead of a made-up percentage when there is no base', () => {
    const s = summarizeHiring([posting({ id: 'a', postedAt: ago(2) })], NOW);
    expect(s.trend30Pct).toBeNull();
    expect(summarizeHiring([], NOW).openRoles).toBe(0);
  });
});

describe('own post classification', () => {
  it('maps the shared news classifier onto post types', () => {
    expect(classifyPost('Acme acquires Nordic payments specialist PayCo').kind).toBe('acquisition');
    expect(classifyPost('Acme reports third-quarter results: revenue up 6%').kind).toBe('results');
    expect(classifyPost('Acme launches AI assistant for business customers').kind).toBe('product');
    expect(classifyPost('Acme appoints new chief financial officer').kind).toBe('leadership');
    expect(classifyPost('Acme to cut 1,000 jobs in Germany').kind).toBe('layoffs');
    expect(classifyPost('Acme opens new engineering hub in Porto with 300 roles').kind).toBe('expansion');
    expect(classifyPost('Acme partners with Microsoft on cloud').kind).toBe('partnership');
  });
});

describe('stated priorities from filing text (deterministic)', () => {
  const MDNA =
    'We continued to invest in our cloud platform and data capabilities. Revenue increased 6% driven by payments. ' +
    'We expect capital expenditures of approximately $1.2 billion in 2027, primarily for manufacturing capacity. ' +
    'We completed a restructuring programme to reduce costs in back-office functions. The weather was mild.';

  it('keeps only sentences with an investment, cut or guidance stance and quotes them verbatim', () => {
    const s = extractStatements(MDNA);
    expect(s.map((x) => x.stance)).toEqual(['invest', 'guidance', 'cut']);
    for (const x of s) expect(MDNA).toContain(x.text);
    expect(s[0]!.theme).toBe('data_ai');
  });
});

describe('investment plan', () => {
  const years = [
    year(2023, { revenue: 1000, capex: 80, rnd: 50, headcount: 9000 }),
    year(2024, { revenue: 1100, capex: 100, rnd: 60, acquisitions: 200, headcount: 9500 }),
    year(2025, { revenue: 1150, capex: 130, rnd: 54, acquisitions: 0, intangibles: 40, headcount: 9000, restructuring: 25 }),
  ];

  it('computes where they invest and cut from filed facts, each line cited', () => {
    const plan = buildInvestmentPlan({ years, statements: [], hiring: null, posts: [] });
    const capex = plan.investing.find((t) => t.area === 'capex');
    expect(capex).toMatchObject({ amount: 130, currency: 'EUR', trendPct: 30, basis: 'observed' });
    expect(capex!.evidenceIds).toEqual(expect.arrayContaining(['fin:2025', 'fin:2024']));
    expect(plan.cutting.find((t) => t.area === 'rnd')).toMatchObject({ trendPct: -10 });
    expect(plan.cutting.find((t) => t.area === 'headcount')).toBeDefined();
    expect(plan.cutting.find((t) => t.area === 'restructuring')).toBeDefined();
    expect([...plan.investing, ...plan.cutting].every((t) => t.evidenceIds.length > 0)).toBe(true);
  });

  it('only infers the next 12 months from two independent kinds of evidence, and says inferred', () => {
    const posts: IntelPost[] = [
      { id: 'p1', origin: 'own', kind: 'product', title: 'Acme launches AI assistant', url: 'https://acme.example/ai', publishedAt: ago(10).toISOString(), source: 'newsroom', sourceLabel: 'Company newsroom', sample: false, evidenceId: 'post:p1' },
    ];
    const hiring = { summary: summarizeHiring([posting({ id: 'h1', title: 'Machine learning engineer', function: 'ml_ai', skills: ['Machine learning'] })], NOW), evidenceIds: ['job:h1'] };
    const plan = buildInvestmentPlan({ years, statements: [{ evidenceId: 'st:1', text: 'We will invest in AI for customer service.', stance: 'invest', theme: 'data_ai' }], hiring, posts });
    const next = plan.next12.find((t) => t.theme === 'data_ai');
    expect(next).toBeDefined();
    expect(next!.basis).toBe('inferred');
    expect(next!.evidenceIds).toEqual(expect.arrayContaining(['st:1', 'job:h1', 'post:p1']));
    // A theme with one kind of evidence stays out of the forecast.
    const lone = buildInvestmentPlan({ years: [], statements: [{ evidenceId: 'st:2', text: 'We will invest in cyber security.', stance: 'invest', theme: 'cyber' }], hiring: null, posts: [] });
    expect(lone.next12).toEqual([]);
  });

  it('has no output and no guesses when there is no data', () => {
    expect(buildInvestmentPlan({ years: [], statements: [], hiring: null, posts: [] })).toEqual({ investing: [], cutting: [], next12: [] });
  });
});

describe('direction', () => {
  it('cross-references financials, hiring, posts and investments into cited claims and bid relevance', () => {
    const years = [year(2024, { revenue: 1000, operatingMargin: 10 }), year(2025, { revenue: 1100, operatingMargin: 12 })];
    const postings = [
      posting({ id: 'h1', title: 'Data engineer, Databricks', function: 'data', skills: ['Databricks'] }),
      posting({ id: 'h2', title: 'ML engineer', function: 'ml_ai', skills: ['Machine learning'] }),
    ];
    const hiring = { summary: summarizeHiring(postings, NOW), evidenceIds: ['job:h1', 'job:h2'] };
    const posts: IntelPost[] = [
      { id: 'p1', origin: 'own', kind: 'product', title: 'Acme launches AI assistant', url: 'https://acme.example/ai', publishedAt: ago(10).toISOString(), source: 'newsroom', sourceLabel: 'Company newsroom', sample: false, evidenceId: 'post:p1' },
      { id: 'n1', origin: 'news', kind: 'acquisition', title: 'Acme to acquire PayCo', url: 'https://news.example/payco', publishedAt: ago(20).toISOString(), source: 'gdelt', sourceLabel: 'GDELT news', sample: false, evidenceId: 'news:n1' },
    ];
    const plan = buildInvestmentPlan({ years, statements: [], hiring, posts });
    const d = buildDirection({ companyName: 'Acme', years, hiring, posts, plan });
    expect(d.claims.find((c) => c.area === 'financials')?.text).toMatch(/Revenue up 10%/);
    expect(d.claims.find((c) => c.area === 'hiring')?.evidenceIds).toEqual(['job:h1', 'job:h2']);
    expect(d.claims.every((c) => c.evidenceIds.length > 0)).toBe(true);
    expect(d.headline?.basis).toBe('inferred');
    expect(d.bidRelevance[0]).toMatchObject({ theme: 'data_ai', offering: 'Data and AI practice' });
    expect(d.bidRelevance[0]!.evidenceIds.length).toBeGreaterThan(1);
  });

  it('says nothing rather than guessing when there are no inputs', () => {
    const d = buildDirection({ companyName: 'Empty', years: [], hiring: null, posts: [], plan: { investing: [], cutting: [], next12: [] } });
    expect(d).toEqual({ headline: null, claims: [], bidRelevance: [] });
  });

  it('rejects a claim without evidence at the API contract', () => {
    const bad = {
      companyId: 'c',
      companyName: 'x',
      computedAt: NOW.toISOString(),
      headline: null,
      claims: [{ id: 'k', area: 'hiring', text: 't', basis: 'observed', theme: null, evidenceIds: [] }],
      investing: [],
      cutting: [],
      next12: [],
      bidRelevance: [],
      evidence: [],
      sources: [],
      sample: false,
    };
    expect(AccountDirection.safeParse(bad).success).toBe(false);
  });
});

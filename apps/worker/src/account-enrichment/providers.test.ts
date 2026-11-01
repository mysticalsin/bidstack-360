import { describe, expect, it } from 'vitest';

import {
  createApolloProvider,
  createSeamlessProvider,
  defaultProviders,
  normalizeDomain,
  parseAmount,
  type ProviderContext,
} from './providers.js';

type Call = { url: string; init: RequestInit };

function mockFetch(responses: Array<{ status?: number; body: unknown; headers?: Record<string, string> }>) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error(`unexpected call ${url}`);
    return new Response(JSON.stringify(next.body), {
      status: next.status ?? 200,
      headers: { 'content-type': 'application/json', ...(next.headers ?? {}) },
    });
  };
  return { calls, fetchImpl };
}

function ctx(budget = 100, maxJobPages = 2): ProviderContext & { reserved: Array<[string, number]> } {
  const reserved: Array<[string, number]> = [];
  let left = budget;
  return {
    reserved,
    maxJobPages,
    reserve: async (op, credits) => {
      if (credits > left) return false;
      left -= credits;
      reserved.push([op, credits]);
      return true;
    },
  };
}

const KEY = 'test-key-not-real';
const APOLLO_ORG = {
  id: 'ap-1',
  name: 'Acme',
  annual_revenue: 125000000,
  annual_revenue_printed: '125M',
  estimated_num_employees: 1200,
  organization_headcount_six_month_growth: 0.04,
  organization_headcount_twelve_month_growth: 0.11,
  organization_headcount_twenty_four_month_growth: 0.2,
  industry: 'information technology & services',
  industries: ['information technology & services', 'computer software'],
  city: 'Paris',
  state: 'Ile-de-France',
  country: 'France',
  suborganizations: [{ name: 'Acme UK', country: 'United Kingdom' }],
  technology_names: ['Snowflake', 'Salesforce'],
  current_technologies: [{ name: 'AWS', category: 'Hosting' }, { name: 'Snowflake' }],
  departmental_head_count: { engineering: 300, sales: 120, finance: 0 },
};

describe('helpers', () => {
  it('normalizes domains and amounts', () => {
    expect(normalizeDomain('https://www.Acme.fr/about')).toBe('acme.fr');
    expect(normalizeDomain('acme.fr')).toBe('acme.fr');
    expect(normalizeDomain('')).toBeNull();
    expect(parseAmount('12,500')).toBe(12500);
    expect(parseAmount('$1.2B')).toBe(1_200_000_000);
    expect(parseAmount('45M')).toBe(45_000_000);
    expect(parseAmount('n/a')).toBeNull();
    expect(parseAmount(42)).toBe(42);
  });
});

describe('apollo provider', () => {
  it('is not configured without APOLLO_API_KEY and spends nothing', async () => {
    const { calls, fetchImpl } = mockFetch([]);
    const p = createApolloProvider({ env: {}, fetchImpl });
    const c = ctx();
    expect(p.configured()).toBe(false);
    const r = await p.enrich({ name: 'Acme', domain: 'acme.fr' }, c);
    expect(r.status).toBe('not_configured');
    expect(calls).toHaveLength(0);
    expect(c.reserved).toHaveLength(0);
  });

  it('needs a domain', async () => {
    const { calls, fetchImpl } = mockFetch([]);
    const r = await createApolloProvider({ env: { APOLLO_API_KEY: KEY }, fetchImpl }).enrich({ name: 'Acme', domain: null }, ctx());
    expect(r.status).toBe('no_domain');
    expect(calls).toHaveLength(0);
  });

  it('maps firmographics and pages job postings, reserving 1 credit per call', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({ id: `j${i}`, title: 'Data Engineer', url: `https://jobs.acme.fr/${i}`, city: 'London', country: 'United Kingdom', posted_at: '2026-10-01' }));
    const { calls, fetchImpl } = mockFetch([
      { body: { organization: APOLLO_ORG } },
      { body: { organization_job_postings: page1 } },
      { body: { organization_job_postings: [{ id: 'jz', title: 'Snowflake Architect', url: 'javascript:alert(1)' }, { id: 'bad' }] } },
    ]);
    const c = ctx();
    const r = await createApolloProvider({ env: { APOLLO_API_KEY: KEY }, fetchImpl }).enrich({ name: 'Acme', domain: 'www.acme.fr' }, c);
    expect(r.status).toBe('ok');
    expect(r.providerCompanyId).toBe('ap-1');
    expect(r.creditsUsed).toBe(3);
    expect(c.reserved).toEqual([
      ['organizations.enrich', 1],
      ['organizations.job_postings', 1],
      ['organizations.job_postings', 1],
    ]);
    expect(r.fields).toMatchObject({
      annualRevenueUsd: 125000000,
      revenueRange: '125M',
      employeeCount: 1200,
      headcountGrowth6m: 0.04,
      headcountGrowth12m: 0.11,
      headcountGrowth24m: 0.2,
      industry: 'information technology & services',
      techStack: ['Snowflake', 'Salesforce', 'AWS'],
      departmentHeadcount: { engineering: 300, sales: 120 },
    });
    expect(r.fields.locations).toEqual([
      { city: 'Paris', state: 'Ile-de-France', country: 'France', kind: 'hq' },
      { city: null, state: null, country: 'United Kingdom', kind: 'subsidiary' },
    ]);
    expect(r.jobPostings).toHaveLength(101);
    expect(r.jobPostings!.at(-1)).toMatchObject({ externalId: 'jz', url: null });
    expect(calls[0]!.url).toBe('https://api.apollo.io/api/v1/organizations/enrich?domain=acme.fr');
    expect(calls[1]!.url).toContain('/organizations/ap-1/job_postings?page=1&per_page=100');
    expect((calls[0]!.init.headers as Record<string, string>)['x-api-key']).toBe(KEY);
  });

  it('stops at the budget and keeps the firmographics', async () => {
    const { calls, fetchImpl } = mockFetch([{ body: { organization: APOLLO_ORG } }]);
    const r = await createApolloProvider({ env: { APOLLO_API_KEY: KEY }, fetchImpl }).enrich({ name: 'Acme', domain: 'acme.fr' }, ctx(1));
    expect(r.status).toBe('budget_exceeded');
    expect(r.fields.employeeCount).toBe(1200);
    expect(r.jobPostings).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it('spends nothing when even the enrich call is over budget', async () => {
    const { calls, fetchImpl } = mockFetch([]);
    const r = await createApolloProvider({ env: { APOLLO_API_KEY: KEY }, fetchImpl }).enrich({ name: 'Acme', domain: 'acme.fr' }, ctx(0));
    expect(r.status).toBe('budget_exceeded');
    expect(calls).toHaveLength(0);
  });

  it('skips postings when maxJobPages is 0', async () => {
    const { calls, fetchImpl } = mockFetch([{ body: { organization: APOLLO_ORG } }]);
    const r = await createApolloProvider({ env: { APOLLO_API_KEY: KEY }, fetchImpl }).enrich({ name: 'Acme', domain: 'acme.fr' }, ctx(10, 0));
    expect(r.status).toBe('ok');
    expect(r.jobPostings).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it('reports 429 with retry-after and never leaks the key', async () => {
    const { fetchImpl } = mockFetch([{ status: 429, body: { error: 'rate_limited' }, headers: { 'retry-after': '30' } }]);
    const r = await createApolloProvider({ env: { APOLLO_API_KEY: KEY }, fetchImpl }).enrich({ name: 'Acme', domain: 'acme.fr' }, ctx());
    expect(r.status).toBe('rate_limited');
    expect(r.retryAfterMs).toBe(30_000);
    expect(JSON.stringify(r)).not.toContain(KEY);
  });

  it('maps a 403 scoped-key error and an empty match', async () => {
    const forbidden = mockFetch([{ status: 403, body: { error_code: 'API_INACCESSIBLE' } }]);
    const r1 = await createApolloProvider({ env: { APOLLO_API_KEY: KEY }, fetchImpl: forbidden.fetchImpl }).enrich({ name: 'Acme', domain: 'acme.fr' }, ctx());
    expect(r1).toMatchObject({ status: 'error', error: '403 API_INACCESSIBLE', creditsUsed: 1 });
    const empty = mockFetch([{ body: {} }]);
    const r2 = await createApolloProvider({ env: { APOLLO_API_KEY: KEY }, fetchImpl: empty.fetchImpl }).enrich({ name: 'Acme', domain: 'acme.fr' }, ctx());
    expect(r2.status).toBe('not_found');
  });

  it('keeps firmographics when the postings call fails', async () => {
    const { fetchImpl } = mockFetch([{ body: { organization: APOLLO_ORG } }, { status: 500, body: {} }]);
    const r = await createApolloProvider({ env: { APOLLO_API_KEY: KEY }, fetchImpl }).enrich({ name: 'Acme', domain: 'acme.fr' }, ctx());
    expect(r.status).toBe('error');
    expect(r.fields.employeeCount).toBe(1200);
    expect(r.creditsUsed).toBe(2);
  });
});

describe('seamless provider', () => {
  const company = {
    id: 'sm-9',
    annualRevenue: '$118M',
    companyRevenue: '$100M - $250M',
    staffCount: '1,150',
    companySize: '1,001-5,000',
    industries: 'Software, IT Services',
    location: { city: 'Paris', state: '', country: 'France', countryAbbr: 'FR' },
    topTechnologies: 'Snowflake, HubSpot',
  };

  it('is not configured without SEAMLESS_API_KEY', async () => {
    const { calls, fetchImpl } = mockFetch([]);
    const p = createSeamlessProvider({ env: {}, fetchImpl });
    expect(p.configured()).toBe(false);
    expect((await p.enrich({ name: 'Acme', domain: 'acme.fr' }, ctx())).status).toBe('not_configured');
    expect(calls).toHaveLength(0);
  });

  it('researches then polls until done (1 credit)', async () => {
    const { calls, fetchImpl } = mockFetch([
      { status: 202, body: { requestIds: ['rq-1'] } },
      { body: { data: [{ requestId: 'rq-1', status: 'researching' }] } },
      { body: { data: [{ requestId: 'rq-1', status: 'done', company }] } },
    ]);
    const c = ctx();
    const r = await createSeamlessProvider({ env: { SEAMLESS_API_KEY: KEY }, fetchImpl, sleep: async () => {} }).enrich({ name: 'Acme', domain: 'acme.fr' }, c);
    expect(r.status).toBe('ok');
    expect(r.creditsUsed).toBe(1);
    expect(c.reserved).toEqual([['companies.research', 1]]);
    expect(r.fields).toEqual({
      annualRevenueUsd: 118_000_000,
      revenueRange: '$100M - $250M',
      employeeCount: 1150,
      employeeRange: '1,001-5,000',
      industry: 'Software',
      industries: ['Software', 'IT Services'],
      locations: [{ city: 'Paris', state: null, country: 'France', kind: 'hq' }],
      techStack: ['Snowflake', 'HubSpot'],
    });
    expect(r.jobPostings).toBeNull();
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ companies: [{ domain: 'acme.fr', companyName: 'Acme' }] });
    expect((calls[0]!.init.headers as Record<string, string>).Token).toBe(KEY);
    expect(calls[1]!.url).toContain('/companies/research/poll?requestIds=rq-1');
  });

  it('leaves the request pending after the poll attempts, and resumes it for free', async () => {
    const first = mockFetch([
      { status: 202, body: { requestIds: ['rq-2'] } },
      { body: { data: [{ requestId: 'rq-2', status: 'researching' }] } },
      { body: { data: [{ requestId: 'rq-2', status: 'researching' }] } },
    ]);
    const r1 = await createSeamlessProvider({ env: { SEAMLESS_API_KEY: KEY }, fetchImpl: first.fetchImpl, pollAttempts: 2, sleep: async () => {} }).enrich({ name: 'Acme', domain: 'acme.fr' }, ctx());
    expect(r1).toMatchObject({ status: 'pending', pendingRequestId: 'rq-2', creditsUsed: 1 });
    const second = mockFetch([{ body: [{ requestId: 'rq-2', status: 'done', company }] }]);
    const c = ctx();
    const r2 = await createSeamlessProvider({ env: { SEAMLESS_API_KEY: KEY }, fetchImpl: second.fetchImpl, sleep: async () => {} }).enrich({ name: 'Acme', domain: 'acme.fr', pendingRequestId: 'rq-2' }, c);
    expect(r2.status).toBe('ok');
    expect(r2.creditsUsed).toBe(0);
    expect(c.reserved).toHaveLength(0);
    expect(second.calls).toHaveLength(1);
  });

  it('maps missing research to not_found and a missing license to error', async () => {
    const missing = mockFetch([{ status: 202, body: { requestIds: ['rq-3'] } }, { body: { data: [{ requestId: 'rq-3', status: 'missing' }] } }]);
    const r1 = await createSeamlessProvider({ env: { SEAMLESS_API_KEY: KEY }, fetchImpl: missing.fetchImpl, sleep: async () => {} }).enrich({ name: 'Acme', domain: 'acme.fr' }, ctx());
    expect(r1.status).toBe('not_found');
    const license = mockFetch([{ status: 422, body: { error: 'missingLicense' } }]);
    const r2 = await createSeamlessProvider({ env: { SEAMLESS_API_KEY: KEY }, fetchImpl: license.fetchImpl }).enrich({ name: 'Acme', domain: 'acme.fr' }, ctx());
    expect(r2).toMatchObject({ status: 'error', error: '422 missingLicense' });
    expect(JSON.stringify(r2)).not.toContain(KEY);
  });

  it('respects the budget before research', async () => {
    const { calls, fetchImpl } = mockFetch([]);
    const r = await createSeamlessProvider({ env: { SEAMLESS_API_KEY: KEY }, fetchImpl }).enrich({ name: 'Acme', domain: 'acme.fr' }, ctx(0));
    expect(r.status).toBe('budget_exceeded');
    expect(calls).toHaveLength(0);
  });
});

it('defaultProviders orders Apollo first, Seamless second', () => {
  expect(defaultProviders({ env: {} }).map((p) => p.id)).toEqual(['apollo', 'seamless']);
});

it('keeps revenue and job postings and does not request or keep phone numbers or leads', async () => {
  const { calls, fetchImpl } = mockFetch([
    {
      body: {
        organization: {
          ...APOLLO_ORG,
          phone: '+1-555-0100',
          primary_phone: { number: '+1-555-0100', sanitized_number: '+15550100' },
          numbers: ['+1-555-0199'],
          leads: [{ name: 'Pat Prospect', email: 'pat@example.com' }],
          people: [{ first_name: 'Ada', title: 'Chief Executive Officer' }],
        },
      },
    },
    {
      body: {
        organization_job_postings: [
          { id: 'j1', title: 'Data Engineer', url: 'https://jobs.acme.fr/1', phone: '+1-555-0102' },
          { id: 'p1', title: 'Chief Executive Officer', first_name: 'Ada', email: 'ada@example.com' },
        ],
      },
    },
  ]);
  const provider = createApolloProvider({ env: { APOLLO_API_KEY: KEY }, fetchImpl });
  expect(provider.searchPeople).toBeUndefined();
  const result = await provider.enrich({ name: 'Acme', domain: 'acme.fr' }, ctx(10, 1));
  expect(result.fields.annualRevenueUsd).toBe(125_000_000);
  expect(result.jobPostings).toEqual([
    expect.objectContaining({ externalId: 'j1', title: 'Data Engineer' }),
  ]);
  expect(calls.map((call) => call.url).join(' ')).not.toMatch(/mixed_people|people\/match|search_people/);
  expect(JSON.stringify(result)).not.toMatch(/555|Pat Prospect|pat@example|ada@example|Ada/);
});

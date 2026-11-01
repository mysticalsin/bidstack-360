import { randomUUID } from 'node:crypto';

import { prisma } from '@bidstack/db';
import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import {
  ApolloEnrichJobData,
  apolloOpenJobCount,
  callApolloEnrich,
  callApolloMcpCompanyIntel,
  createApolloEnrichJobSignature,
  fetchCompanyNewsCrossCheck,
  mapApolloOrganization,
  normalizeName,
  processCompanyEnrichApolloJob,
  resolveApolloEnrichmentTransport,
  sanitizeApolloPayload,
  verifyApolloEnrichJobSignature,
} from './company-enrich-apollo.js';

describe('resolveApolloEnrichmentTransport', () => {
  it('uses Apollo MCP only when URL and bearer token are both configured', () => {
    expect(
      resolveApolloEnrichmentTransport({
        hasDomain: false,
        env: {
          APOLLO_MCP_URL: 'https://mcp.apollo.test/mcp',
          APOLLO_MCP_BEARER_TOKEN: 'token',
        },
      }),
    ).toEqual({
      kind: 'mcp',
      url: 'https://mcp.apollo.test/mcp',
      bearerToken: 'token',
    });

    expect(
      resolveApolloEnrichmentTransport({
        hasDomain: true,
        env: { APOLLO_MCP_URL: 'https://mcp.apollo.test/mcp' },
      }),
    ).toMatchObject({
      kind: 'none',
      reason: expect.stringContaining('partially configured'),
    });
  });

  it('falls back to Apollo REST only with an API key and company domain', () => {
    expect(
      resolveApolloEnrichmentTransport({
        hasDomain: true,
        env: { APOLLO_API_KEY: 'apollo-key' },
      }),
    ).toEqual({ kind: 'api', apiKey: 'apollo-key' });

    expect(
      resolveApolloEnrichmentTransport({
        hasDomain: false,
        env: { APOLLO_API_KEY: 'apollo-key' },
      }),
    ).toMatchObject({
      kind: 'none',
      reason: expect.stringContaining('domain'),
    });
  });
});

describe('mapApolloOrganization', () => {
  it('maps a fully populated Apollo response to enrichment fields', () => {
    const mapped = mapApolloOrganization({
      name: 'Mantu Group SA',
      primary_domain: 'WWW.Mantu.com',
      website_url: 'https://mantu.com/',
      industry: 'consulting',
      estimated_num_employees: 12000,
      annual_revenue: 1_200_000_000,
      founded_year: 2007,
      logo_url: 'https://logo.clearbit.com/mantu.com',
      organization_industries: ['consulting', 'staffing & recruiting'],
      former_names: ['Amaris Consulting'],
    });

    // The organization label stays off the legal-name field.
    expect(mapped.legalName).toBeNull();
    // domain is normalized — lowercased, www-stripped
    expect(mapped.domain).toBe('mantu.com');
    expect(mapped.website).toBe('https://mantu.com/');
    expect(mapped.industry).toBe('consulting');
    expect(mapped.employeeCount).toBe(12000);
    // annual revenue stored as micros (integer × 1e6) per CLAUDE.md
    expect(mapped.annualRevenueMicros).toBe(1_200_000_000_000_000n);
    expect(mapped.incorporationDate?.toISOString()).toBe('2007-01-01T00:00:00.000Z');
    expect(mapped.logoUrl).toBe('https://logo.clearbit.com/mantu.com');
    expect(mapped.industryCodes).toEqual(['consulting', 'staffing & recruiting']);
    expect(mapped.formerNames).toEqual(['Amaris Consulting']);
  });

  it('coerces stringified numeric fields Apollo sometimes returns', () => {
    const mapped = mapApolloOrganization({
      name: 'Acme',
      estimated_num_employees: '450',
      annual_revenue: '7500000.5',
      founded_year: '1998',
    });

    expect(mapped.employeeCount).toBe(450);
    // 7,500,000.5 USD → 7,500,000,500,000 micros (rounded)
    expect(mapped.annualRevenueMicros).toBe(7_500_000_500_000n);
    expect(mapped.incorporationDate?.getUTCFullYear()).toBe(1998);
  });

  it('keeps a large revenue string as integer micros', () => {
    // WHY: Math.round(Number(text) * 1e6) cannot store this remainder.
    const mapped = mapApolloOrganization({
      name: 'Large Co',
      annual_revenue: '8598204328457.184962',
    });
    expect(mapped.annualRevenueMicros).toBe(8_598_204_328_457_184_962n);
    expect(mapped.strategicIntel.annualRevenueMicros).toBeNull();
  });

  it('stores a safe public-scale revenue without dropping it', () => {
    const mapped = mapApolloOrganization({
      name: 'DNB',
      annual_revenue: 54_857_000_000,
    });
    expect(mapped.annualRevenueMicros).toBe(54_857_000_000_000_000n);
  });

  it('falls back to organization_revenue when annual_revenue is absent', () => {
    // Apollo returns revenue under `organization_revenue` on some endpoints
    // (verified live against the bulk enrich API) rather than `annual_revenue`.
    // Without this fallback the worker captured employees but DROPPED revenue.
    const mapped = mapApolloOrganization({
      name: 'Demo Co',
      estimated_num_employees: 500,
      organization_revenue: 7_500_000,
    });

    expect(mapped.employeeCount).toBe(500);
    expect(mapped.annualRevenueMicros).toBe(7_500_000_000_000n);
  });

  it('maps Apollo strategic account intelligence without contact channels', () => {
    const mapped = mapApolloOrganization(
      {
        name: 'Acme',
        primary_domain: 'acme.com',
        estimated_num_employees: 850,
        annual_revenue: 42_000_000,
        intent_topics: [{ topic: 'cloud migration' }, { name: 'managed security' }],
        technologies: [{ name: 'Salesforce' }, 'Snowflake'],
        latest_news: [
          {
            title: 'Acme opens Brazil delivery hub',
            summary: 'Expansion into Sao Paulo adds regional delivery capacity.',
            url: 'https://news.example/acme-brazil',
            published_at: '2026-05-28T10:00:00Z',
          },
        ],
        funding_events: [
          {
            round: 'Strategic investment',
            amount: '$40M',
            date: '2026-05-20',
          },
        ],
        senior_leadership: [
          {
            name: 'Jane Doe',
            title: 'Chief Financial Officer',
            email: 'jane@example.com',
            phone: '+1-555-0101',
            change_type: 'promoted',
          },
        ],
      },
      {
        syncMode: 'apollo_mcp_get_company',
        creditPolicy: 'free_search',
        now: new Date('2026-05-30T12:00:00Z'),
        newsCrossCheck: {
          articles: [
            {
              title: 'Acme accelerates Latin America expansion',
              summary: 'A second source reports investment in Brazil and Colombia delivery.',
              url: 'https://wire.example/acme-latam',
              seendate: '2026-05-29T08:00:00Z',
              domain: 'wire.example',
              contact_email: 'editor@example.com',
            },
          ],
        },
        jobPostings: {
          items: [
            {
              title: 'Director of Enterprise Architecture',
              department: 'IT',
              phone: '+1-555-9999',
            },
          ],
        },
      },
    );

    expect(mapped.strategicIntel.syncMode).toBe('apollo_mcp_get_company');
    expect(mapped.strategicIntel.creditPolicy).toBe('free_search');
    expect(mapped.strategicIntel.intentTopics).toEqual(['cloud migration', 'managed security']);
    expect(mapped.strategicIntel.employeeTrend).toBe('hiring');
    expect(mapped.strategicIntel.hiringSignals[0]?.label).toBe(
      'Director of Enterprise Architecture',
    );
    expect(mapped.strategicIntel.leadershipSignals[0]?.label).toContain('Chief Financial Officer');
    expect(mapped.strategicIntel.newsSignals.map((signal) => signal.label)).toEqual([
      'Acme opens Brazil delivery hub',
      'Strategic investment',
      'Acme accelerates Latin America expansion',
    ]);
    expect(mapped.strategicIntel.newsSignals.at(-1)?.source).toBe('gdelt_news');
    expect(mapped.strategicIntel.signals.some((signal) => signal.kind === 'news')).toBe(true);
    expect(mapped.strategicIntel.signals.some((signal) => signal.kind === 'funding')).toBe(true);
    expect(JSON.stringify(mapped.strategicIntel)).not.toMatch(/jane@example|editor@example|555/);
    expect(mapped.technicalStack.map((item) => item.name)).toEqual(['Salesforce', 'Snowflake']);
  });

  it('prefers annual_revenue over organization_revenue when both are present', () => {
    const mapped = mapApolloOrganization({
      name: 'Demo Co',
      annual_revenue: 1_000_000,
      organization_revenue: 9_999_999,
    });

    expect(mapped.annualRevenueMicros).toBe(1_000_000_000_000n);
  });

  it('returns null fields when Apollo omits or nulls them', () => {
    const mapped = mapApolloOrganization({ name: null });

    expect(mapped.legalName).toBeNull();
    expect(mapped.domain).toBeNull();
    expect(mapped.employeeCount).toBeNull();
    expect(mapped.annualRevenueMicros).toBeNull();
    expect(mapped.incorporationDate).toBeNull();
    expect(mapped.industryCodes).toEqual([]);
    expect(mapped.formerNames).toEqual([]);
  });

  it('rejects nonsensical founded_year values', () => {
    expect(mapApolloOrganization({ founded_year: 0 }).incorporationDate).toBeNull();
    expect(mapApolloOrganization({ founded_year: 9999 }).incorporationDate).toBeNull();
    expect(mapApolloOrganization({ founded_year: 'NaN' }).incorporationDate).toBeNull();
  });
});

describe('normalizeName', () => {
  it('matches the API route normalization (so the upsert hits the same row)', () => {
    expect(normalizeName('CI Financial')).toBe('ci-financial');
    expect(normalizeName('  Rush University System for Health  ')).toBe(
      'rush-university-system-for-health',
    );
    expect(normalizeName('AT&T, Inc.')).toBe('at-t-inc');
  });
});

describe('sanitizeApolloPayload', () => {
  it('drops phone numbers and contact leads before metadata persistence', () => {
    expect(
      sanitizeApolloPayload({
        name: 'Acme',
        annual_revenue: 125_000_000,
        organization_num_jobs: 17,
        email: 'ceo@example.com',
        sanitized_phone: '+15550101',
        numbers: ['+15550102'],
        nested: { mobilePhone: '+15550202', number: '+15550303', title: 'CEO' },
        people: [{ name: 'Jane Doe', email_status: 'verified', phone_numbers: ['x'] }],
        leads: [{ name: 'Pat Prospect' }],
        org_chart_root_people_ids: ['person-1'],
      }),
    ).toEqual({
      name: 'Acme',
      annual_revenue: 125_000_000,
      organization_num_jobs: 17,
      nested: { title: 'CEO' },
    });
  });
});

describe('ApolloEnrichJobData', () => {
  it('requires orgId (uuid) and companyName, allows optional domain/signature', () => {
    expect(
      ApolloEnrichJobData.safeParse({
        orgId: '11111111-2222-3333-4444-555555555555',
        companyName: 'Mantu',
        signature: 'signed',
      }).success,
    ).toBe(true);

    expect(ApolloEnrichJobData.safeParse({ orgId: 'not-a-uuid', companyName: 'x' }).success).toBe(
      false,
    );
    expect(ApolloEnrichJobData.safeParse({ companyName: 'x' }).success).toBe(false);
  });
});

describe('verifyApolloEnrichJobSignature', () => {
  const job = {
    orgId: '11111111-2222-3333-4444-555555555555',
    companyName: 'Mantu',
    domain: 'mantu.com',
  };

  it('accepts a valid signed job in production', () => {
    const secret = 'test-secret';
    const signature = createApolloEnrichJobSignature(job, secret);

    expect(
      verifyApolloEnrichJobSignature({ ...job, signature }, { secret, nodeEnv: 'production' }),
    ).toBe(true);
  });

  it('rejects unsigned or tampered jobs in production', () => {
    const secret = 'test-secret';
    const signature = createApolloEnrichJobSignature(job, secret);

    expect(verifyApolloEnrichJobSignature(job, { secret, nodeEnv: 'production' })).toBe(false);
    expect(
      verifyApolloEnrichJobSignature(
        { ...job, companyName: 'Other Company', signature },
        { secret, nodeEnv: 'production' },
      ),
    ).toBe(false);
    expect(verifyApolloEnrichJobSignature(job, { secret: null, nodeEnv: 'production' })).toBe(
      false,
    );
  });

  it('keeps unsigned local/dev jobs working when no signing secret exists', () => {
    expect(verifyApolloEnrichJobSignature(job, { secret: null, nodeEnv: 'development' })).toBe(
      true,
    );
    expect(verifyApolloEnrichJobSignature(job, { secret: null, nodeEnv: 'test' })).toBe(true);
  });
});

describe('callApolloEnrich', () => {
  it('GETs Apollo organization enrichment with X-Api-Key and returns the parsed organization', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          organization: {
            name: 'Mantu',
            primary_domain: 'mantu.com',
            estimated_num_employees: 12000,
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const org = await callApolloEnrich({
      apiKey: 'test-key',
      companyName: 'Mantu',
      domain: 'mantu.com',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(org.name).toBe('Mantu');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://api.apollo.io/api/v1/organizations/enrich?domain=mantu.com');
    expect(init.method).toBe('GET');
    // X-Api-Key header (not Authorization) per Apollo docs
    expect((init.headers as Record<string, string>)['X-Api-Key']).toBe('test-key');
  });

  it('throws on non-2xx responses with the upstream status', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('rate limited', { status: 429 }));

    await expect(
      callApolloEnrich({
        apiKey: 'k',
        companyName: 'Mantu',
        domain: 'mantu.com',
        fetchImpl: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/429/);
  });

  it('requires a domain for REST organization enrichment', async () => {
    await expect(
      callApolloEnrich({
        apiKey: 'k',
        companyName: 'Mantu',
      }),
    ).rejects.toThrow(/requires a company domain/);
  });
});

describe('Apollo company revenue and open jobs', () => {
  it('keeps dollar revenue as micros and an open-job count, and drops phones and leads', () => {
    const org = {
      name: 'Acme',
      primary_domain: 'acme.com',
      annual_revenue: 125_000_000,
      organization_num_jobs: 17,
      phone: '+1-555-0100',
      primary_phone: { number: '+1-555-0100', sanitized_number: '+15550100' },
      numbers: ['+1-555-0199'],
      leads: [{ name: 'Pat Prospect', email: 'pat@example.com', title: 'Chief Executive Officer' }],
      people: [{ first_name: 'Ada', title: 'VP Sales', email: 'ada@example.com' }],
      job_postings: [
        { title: 'Data Engineer', department: 'IT' },
        { first_name: 'Ada', title: 'VP Sales', email: 'ada@example.com' },
      ],
    };
    const mapped = mapApolloOrganization(org, {
      syncMode: 'apollo_api_organization_enrich',
      now: new Date('2026-05-30T12:00:00Z'),
      executives: {
        people: [
          {
            name: 'Jane Doe',
            title: 'Chief Revenue Officer',
            email: 'jane@example.com',
            phone: '+1-555-0101',
          },
        ],
      },
    });

    expect(mapped.annualRevenueMicros).toBe(125_000_000_000_000n);
    expect(mapped.strategicIntel.annualRevenueMicros).toBe(125_000_000_000_000);
    // The company payload's count wins over the two-row sample.
    expect(mapped.strategicIntel.openJobCount).toBe(17);
    expect(apolloOpenJobCount(org)).toBe(17);
    expect(mapped.strategicIntel.hiringSignals.map((signal) => signal.label)).toEqual([
      'Data Engineer',
    ]);
    expect(mapped.strategicIntel.leadershipSignals).toEqual([]);
    const stored = JSON.stringify(sanitizeApolloPayload(org));
    expect(stored).not.toMatch(/555|Pat Prospect|pat@example|ada@example|Jane Doe|\bAda\b/);
    expect(stored).toContain('125000000');
    expect(stored).toContain('"organization_num_jobs":17');
  });

  it('counts a job-posting list and does not invent a count from leads', () => {
    const mapped = mapApolloOrganization(
      {
        name: 'Acme',
        organization_revenue: 7_500_000,
        leads: [{ name: 'Pat Prospect', title: 'Director' }],
      },
      {
        jobPostings: {
          pagination: { total_entries: 4 },
          organization_job_postings: [{ title: 'Architect' }, { title: 'Analyst' }],
          people: [{ first_name: 'Ada', title: 'CEO', email: 'ada@example.com' }],
        },
      },
    );

    expect(mapped.annualRevenueMicros).toBe(7_500_000_000_000n);
    expect(mapped.strategicIntel.openJobCount).toBe(4);
  });

  it('leaves revenue and open jobs empty when Apollo omits them', () => {
    const mapped = mapApolloOrganization({
      name: 'Acme',
      phone: '+1-555-0100',
      numbers: ['+1-555-0199'],
      leads: [{ name: 'Pat Prospect' }],
    });

    expect(mapped.annualRevenueMicros).toBeNull();
    expect(mapped.strategicIntel.openJobCount).toBeNull();
    expect(mapped.strategicIntel.annualRevenueMicros).toBeNull();
    expect(JSON.stringify(mapped)).not.toMatch(/555|Pat Prospect/);
  });
});

describe('fetchCompanyNewsCrossCheck', () => {
  it('queries public news for strategic company signals and strips contact channels', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          articles: [
            {
              title: 'Acme announces $40M investment',
              url: 'https://news.example/acme',
              seendate: '2026-05-29T08:00:00Z',
              sourcecountry: 'US',
              editor_email: 'editor@example.com',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const result = await fetchCompanyNewsCrossCheck({
      companyName: 'Acme',
      domain: 'www.acme.com',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(result.source).toBe('gdelt_news');
    expect(result.articles).toEqual([
      {
        title: 'Acme announces $40M investment',
        url: 'https://news.example/acme',
        seendate: '2026-05-29T08:00:00Z',
        sourcecountry: 'US',
      },
    ]);
    const [url] = fetchMock.mock.calls[0]!;
    const requestUrl = new URL(String(url));
    expect(requestUrl.origin + requestUrl.pathname).toBe(
      'https://api.gdeltproject.org/api/v2/doc/doc',
    );
    expect(requestUrl.searchParams.get('mode')).toBe('ArtList');
    expect(requestUrl.searchParams.get('format')).toBe('json');
    expect(requestUrl.searchParams.get('query')).toContain('"Acme"');
    expect(requestUrl.searchParams.get('query')).toContain('"acme.com"');
  });

  it('fails loudly when the company name is missing', async () => {
    await expect(fetchCompanyNewsCrossCheck({ companyName: '   ' })).rejects.toThrow(
      /requires a company name/,
    );
  });
});

describe('callApolloMcpCompanyIntel', () => {
  it('uses MCP company search/get-company and excludes people/credit tools by default', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }), {
          status: 200,
          headers: { 'content-type': 'application/json', 'Mcp-Session-Id': 'session-1' },
        }),
      )
      .mockResolvedValueOnce(new Response('', { status: 202 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 2,
            result: {
              structuredContent: {
                companies: [{ id: 'apollo-1', name: 'Acme', primary_domain: 'acme.com' }],
              },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 3,
            result: {
              structuredContent: {
                company: {
                  id: 'apollo-1',
                  name: 'Acme Corp',
                  primary_domain: 'acme.com',
                  estimated_num_employees: 850,
                },
              },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );

    const intel = await callApolloMcpCompanyIntel({
      url: 'https://apollo.test/mcp',
      bearerToken: 'token',
      companyName: 'Acme',
      domain: 'acme.com',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(intel.syncMode).toBe('apollo_mcp_get_company');
    expect(intel.creditPolicy).toBe('unknown');
    expect(intel.organization.name).toBe('Acme Corp');

    const toolCalls = fetchMock.mock.calls
      .map((call) => JSON.parse((call[1] as RequestInit).body as string))
      .filter((body) => body.method === 'tools/call')
      .map((body) => body.params.name);
    expect(toolCalls).toEqual(['search_companies', 'get_company']);
  });

  it('does not call MCP people search even when executive search is requested', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }), {
          status: 200,
          headers: { 'content-type': 'application/json', 'Mcp-Session-Id': 'session-1' },
        }),
      )
      .mockResolvedValueOnce(new Response('', { status: 202 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 2,
            result: {
              structuredContent: {
                companies: [{ id: 'apollo-1', name: 'Acme', primary_domain: 'acme.com' }],
              },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 3,
            result: {
              structuredContent: {
                company: { id: 'apollo-1', name: 'Acme', primary_domain: 'acme.com' },
              },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 4,
            result: {
              structuredContent: {
                people: [
                  {
                    name: 'Jane Doe',
                    title: 'Chief Executive Officer',
                    email: 'jane@example.com',
                    phone: '+1-555-0101',
                  },
                ],
              },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );

    const intel = await callApolloMcpCompanyIntel({
      url: 'https://apollo.test/mcp',
      companyName: 'Acme',
      domain: 'acme.com',
      includeExecutiveSearch: true,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(JSON.stringify(intel.raw)).not.toMatch(/jane@example|555|search_people/);
    const toolCalls = fetchMock.mock.calls
      .map((call) => JSON.parse((call[1] as RequestInit).body as string))
      .filter((body) => body.method === 'tools/call')
      .map((body) => body.params.name);
    expect(toolCalls).toEqual(['search_companies', 'get_company']);
    expect(toolCalls).not.toContain('search_people');
  });
});

describe('processCompanyEnrichApolloJob persistence', () => {
  it('stores revenue micros and an open-job count from a company enrich fixture', async () => {
    // WHY: CompanyEnrichment.legalName is NOT NULL, and Apollo does not return a
    // legal name. A null write rejects the whole upsert, so revenue and the
    // open-job count never land. Phones and leads must not be stored either.
    const org = await prisma.org.create({
      data: {
        clerkOrg: `apollo-fixture-${randomUUID()}`,
        name: 'Apollo fixture pull',
      },
    });
    const previous = {
      APOLLO_API_KEY: process.env.APOLLO_API_KEY,
      APOLLO_MCP_URL: process.env.APOLLO_MCP_URL,
      APOLLO_MCP_BEARER_TOKEN: process.env.APOLLO_MCP_BEARER_TOKEN,
      APOLLO_NEWS_CROSSCHECK_ENABLED: process.env.APOLLO_NEWS_CROSSCHECK_ENABLED,
    };
    const calls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      calls.push(`${url.origin}${url.pathname}`);
      if (url.pathname !== '/api/v1/organizations/enrich') {
        throw new Error(`unexpected Apollo request ${url.origin}${url.pathname}`);
      }
      return new Response(
        JSON.stringify({
          organization: {
            name: 'Apollo Fixture Industries',
            primary_domain: 'apollo-fixture.example',
            website_url: 'https://apollo-fixture.example',
            industry: 'information technology & services',
            estimated_num_employees: 1200,
            annual_revenue: 125_000_000,
            organization_num_jobs: 17,
            phone: '+1-555-0100',
            primary_phone: { number: '+1-555-0100', sanitized_number: '+15550100' },
            numbers: ['+1-555-0199'],
            leads: [{ name: 'Pat Prospect', email: 'pat@example.com', title: 'Director' }],
            people: [{ first_name: 'Ada', email: 'ada@example.com', title: 'VP Sales' }],
            job_postings: [{ title: 'Data Engineer', department: 'IT' }],
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;

    try {
      process.env.APOLLO_API_KEY = 'fixture-pull';
      delete process.env.APOLLO_MCP_URL;
      delete process.env.APOLLO_MCP_BEARER_TOKEN;
      process.env.APOLLO_NEWS_CROSSCHECK_ENABLED = 'false';

      const result = await processCompanyEnrichApolloJob(
        {
          orgId: org.id,
          companyName: 'Apollo Fixture Industries',
          domain: 'apollo-fixture.example',
        },
        pino({ level: 'silent' }),
      );

      expect(result).toEqual({ enrichmentId: expect.any(String) });
      expect(calls).toEqual(['https://api.apollo.io/api/v1/organizations/enrich']);
      expect(calls.join(' ')).not.toMatch(/mixed_people|search_people|people\/match/);

      const row = await prisma.companyEnrichment.findUniqueOrThrow({
        where: {
          orgId_normalizedName: {
            orgId: org.id,
            normalizedName: 'apollo-fixture-industries',
          },
        },
      });
      const stored = JSON.stringify(row, (_key, value) =>
        typeof value === 'bigint' ? value.toString() : value,
      );
      expect(row.annualRevenueMicros).toBe(125_000_000_000_000n);
      expect(row.legalName).toBe('Apollo Fixture Industries');
      expect(stored).not.toMatch(/555|pat@example|ada@example|Pat Prospect|\bAda\b|primary_phone/);
      const metadata = row.providerMetadata as {
        apollo?: { strategicIntel?: { openJobCount?: number; annualRevenueMicros?: number } };
      };
      expect(metadata.apollo?.strategicIntel?.annualRevenueMicros).toBe(125_000_000_000_000);
      expect(metadata.apollo?.strategicIntel?.openJobCount).toBe(17);
    } finally {
      globalThis.fetch = originalFetch;
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await prisma.org.delete({ where: { id: org.id } });
    }
  });
});

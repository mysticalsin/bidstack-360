import { describe, expect, it, vi } from 'vitest';

import {
  ApolloEnrichJobData,
  callApolloEnrich,
  callApolloMcpCompanyIntel,
  callApolloPeopleEnrich,
  callApolloPeopleSearch,
  createApolloEnrichJobSignature,
  mapApolloOrganization,
  normalizeName,
  sanitizeApolloPayload,
  verifyApolloEnrichJobSignature,
} from './company-enrich-apollo.js';

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

    expect(mapped.legalName).toBe('Mantu Group SA');
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
    expect(JSON.stringify(mapped.strategicIntel)).not.toMatch(/jane@example|555/);
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
  it('recursively removes email and phone fields before metadata persistence', () => {
    expect(
      sanitizeApolloPayload({
        name: 'Acme',
        email: 'ceo@example.com',
        sanitized_phone: '+15550101',
        nested: { mobilePhone: '+15550202', title: 'CEO' },
        people: [{ name: 'Jane Doe', email_status: 'verified', phone_numbers: ['x'] }],
      }),
    ).toEqual({
      name: 'Acme',
      nested: { title: 'CEO' },
      people: [{ name: 'Jane Doe' }],
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

describe('callApolloPeopleSearch', () => {
  it('POSTs Apollo People Search by company domain for executive signals without contact fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          people: [
            {
              id: 'person-1',
              name: 'Jane Doe',
              title: 'Chief Revenue Officer',
              email: 'jane@example.com',
              phone: '+1-555-0101',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const result = await callApolloPeopleSearch({
      apiKey: 'test-key',
      companyName: 'Acme',
      domain: 'www.acme.com',
      perPage: 7,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(result.people).toHaveLength(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    const requestUrl = new URL(String(url));
    expect(requestUrl.toString()).toContain(
      'https://api.apollo.io/api/v1/mixed_people/api_search?',
    );
    expect(requestUrl.searchParams.getAll('q_organization_domains_list[]')).toEqual(['acme.com']);
    expect(requestUrl.searchParams.getAll('person_seniorities[]')).toContain('c_suite');
    expect(requestUrl.searchParams.getAll('person_titles[]')).toContain('chief revenue officer');
    expect(requestUrl.searchParams.get('include_similar_titles')).toBe('false');
    expect(requestUrl.searchParams.get('per_page')).toBe('7');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-key');
    expect((init.headers as Record<string, string>)['X-Api-Key']).toBe('test-key');
  });

  it('feeds People Search results into leadership signals and strips contact channels', () => {
    const mapped = mapApolloOrganization(
      {
        name: 'Acme',
        primary_domain: 'acme.com',
      },
      {
        syncMode: 'apollo_api_organization_enrich',
        creditPolicy: 'uses_credits',
        now: new Date('2026-05-30T12:00:00Z'),
        executives: {
          people: [
            {
              id: 'person-1',
              name: 'Jane Doe',
              title: 'Chief Revenue Officer',
              email: 'jane@example.com',
              phone: '+1-555-0101',
              linkedin_url: 'https://www.linkedin.com/in/jane-doe/',
            },
          ],
        },
      },
    );

    expect(mapped.strategicIntel.leadershipSignals[0]?.label).toBe(
      'Jane Doe - Chief Revenue Officer',
    );
    expect(JSON.stringify(mapped.strategicIntel.leadershipSignals)).not.toMatch(/jane@example|555/);
  });
});

describe('callApolloPeopleEnrich', () => {
  it('uses People Enrichment only with contact reveal and waterfall flags forced off', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          person: {
            id: 'person-1',
            name: 'Jane Doe',
            title: 'Chief Revenue Officer',
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const result = await callApolloPeopleEnrich({
      apiKey: 'test-key',
      domain: 'acme.com',
      personId: 'person-1',
      name: 'Jane Doe',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(result.person).toEqual(
      expect.objectContaining({ id: 'person-1', title: 'Chief Revenue Officer' }),
    );
    const [url, init] = fetchMock.mock.calls[0]!;
    const requestUrl = new URL(String(url));
    expect(requestUrl.toString()).toContain('https://api.apollo.io/api/v1/people/match?');
    expect(requestUrl.searchParams.get('domain')).toBe('acme.com');
    expect(requestUrl.searchParams.get('id')).toBe('person-1');
    expect(requestUrl.searchParams.get('reveal_personal_emails')).toBe('false');
    expect(requestUrl.searchParams.get('reveal_phone_number')).toBe('false');
    expect(requestUrl.searchParams.get('run_waterfall_email')).toBe('false');
    expect(requestUrl.searchParams.get('run_waterfall_phone')).toBe('false');
    expect(init.method).toBe('POST');
  });

  it('requires an identifier before using credit-sensitive people enrichment', async () => {
    await expect(
      callApolloPeopleEnrich({
        apiKey: 'test-key',
        domain: 'acme.com',
      }),
    ).rejects.toThrow(/requires personId, name, or linkedinUrl/);
  });
});

describe('callApolloMcpCompanyIntel', () => {
  it('uses MCP company search/get-company and excludes credit tools by default', async () => {
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
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 4,
            result: {
              structuredContent: {
                people: [{ name: 'Jane Doe', title: 'Chief Executive Officer' }],
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
    expect(intel.creditPolicy).toBe('free_search');
    expect(intel.organization.name).toBe('Acme Corp');

    const toolCalls = fetchMock.mock.calls
      .map((call) => JSON.parse((call[1] as RequestInit).body as string))
      .filter((body) => body.method === 'tools/call')
      .map((body) => body.params.name);
    expect(toolCalls).toEqual(['search_companies', 'get_company', 'search_people']);
  });
});

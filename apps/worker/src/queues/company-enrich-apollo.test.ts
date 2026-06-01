import { describe, expect, it, vi } from 'vitest';

import {
  ApolloEnrichJobData,
  callApolloEnrich,
  createApolloEnrichJobSignature,
  mapApolloOrganization,
  normalizeName,
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
  it('POSTs to Apollo with X-Api-Key and returns the parsed organization', async () => {
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
    expect(url).toBe('https://api.apollo.io/v1/organizations/enrich');
    expect(init.method).toBe('POST');
    // X-Api-Key header (not Authorization) per Apollo docs
    expect((init.headers as Record<string, string>)['X-Api-Key']).toBe('test-key');
    expect(JSON.parse(init.body as string)).toEqual({
      organization_name: 'Mantu',
      domain: 'mantu.com',
    });
  });

  it('throws on non-2xx responses with the upstream status', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('rate limited', { status: 429 }));

    await expect(
      callApolloEnrich({
        apiKey: 'k',
        companyName: 'Mantu',
        fetchImpl: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/429/);
  });

  it('omits the domain field from the body when not provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ organization: { name: 'Mantu' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await callApolloEnrich({
      apiKey: 'k',
      companyName: 'Mantu',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body).toEqual({ organization_name: 'Mantu' });
    expect(body).not.toHaveProperty('domain');
  });
});

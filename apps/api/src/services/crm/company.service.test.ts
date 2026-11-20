import { beforeEach, describe, expect, it, vi } from 'vitest';

import { autopopulateCompanies, isFreshCompanyEnrichment } from './company.service.js';
import { queueApolloEnrichment, upsertVerifiedCompanyEnrichment } from './enrichment.service.js';

vi.mock('./enrichment.service.js', () => ({
  queueApolloEnrichment: vi.fn(),
  upsertVerifiedCompanyEnrichment: vi.fn(),
}));

const mockedUpsert = vi.mocked(upsertVerifiedCompanyEnrichment);
const mockedQueueApollo = vi.mocked(queueApolloEnrichment);

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

function logStub() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
  };
}

function companyPayload(name: string, domain: string | null) {
  return {
    id: name.toLowerCase().replace(/\s+/g, '-'),
    source: 'verified_data',
    name,
    legalName: name,
    domain,
    website: domain ? `https://${domain}/` : null,
    industry: null,
    employeeCount: null,
    annualRevenueMicros: null,
    status: 'active',
    registryIds: {},
    formerNames: [],
    incorporationDate: null,
    imageUrl: null,
    logo: {
      url: domain ? `https://${domain}/favicon.ico` : null,
      source: 'favicon',
      cachedAt: '2026-06-07T00:00:00.000Z',
      attribution: {
        source: 'favicon',
        label: 'Company favicon fallback',
        sourceUrl: domain ? `https://${domain}/` : null,
        confidence: 0.62,
      },
    },
    confidence: 0.72,
    sourceAttribution: [],
    updatedAt: '2026-06-07T00:00:00.000Z',
  } as const;
}

describe('autopopulateCompanies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('queues Apollo verification for every newly enriched sales company', async () => {
    const prisma = {
      opportunity: {
        findMany: vi.fn().mockResolvedValue([
          {
            customer: 'Acme Industrial',
            valueMicros: 10_000_000n,
            updatedAt: new Date('2026-06-07T00:00:00.000Z'),
          },
          {
            customer: 'Globex Expansion',
            valueMicros: 5_000_000n,
            updatedAt: new Date('2026-06-07T00:00:00.000Z'),
          },
        ]),
      },
      companyEnrichment: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    mockedUpsert.mockImplementation(async ({ name }) => ({
      company: companyPayload(name, name === 'Acme Industrial' ? 'acme.example' : null),
      domain: name === 'Acme Industrial' ? 'acme.example' : null,
      providers: ['favicon'],
    }));
    mockedQueueApollo.mockResolvedValue('apollo-job');

    const result = await autopopulateCompanies({
      orgId: ORG_ID,
      userId: USER_ID,
      limit: 2,
      source: 'opportunities',
      prisma: prisma as never,
      log: logStub(),
    });

    expect(result.enriched).toBe(2);
    expect(mockedQueueApollo).toHaveBeenCalledTimes(2);
    expect(mockedQueueApollo).toHaveBeenNthCalledWith(1, {
      orgId: ORG_ID,
      companyName: 'Acme Industrial',
      domain: 'acme.example',
      log: expect.any(Object),
    });
    expect(mockedQueueApollo).toHaveBeenNthCalledWith(2, {
      orgId: ORG_ID,
      companyName: 'Globex Expansion',
      domain: null,
      log: expect.any(Object),
    });
  });

  it('does not queue Apollo for fresh cached company enrichment rows', async () => {
    const prisma = {
      opportunity: {
        findMany: vi.fn().mockResolvedValue([
          {
            customer: 'Cached Account',
            valueMicros: 10_000_000n,
            updatedAt: new Date(Date.now() - 24 * 3600 * 1000),
          },
        ]),
      },
      companyEnrichment: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'cached-account',
            normalizedName: 'cached-account',
            tradeName: 'Cached Account',
            legalName: 'Cached Account',
            domain: 'cached.example',
            website: 'https://cached.example/',
            industryCodes: [],
            providerMetadata: {},
            employeeCount: 500,
            annualRevenueMicros: null,
            status: 'active',
            registryIds: {},
            formerNames: [],
            incorporationDate: null,
            logoUrl: 'https://cached.example/favicon.ico',
            logoSource: 'favicon',
            confidenceBps: 8200,
            sourceAttribution: [],
            // Relative to the real clock: autopopulateCompanies takes no `now`
            // injection, so a fixed expiry date would rot into "stale" once the
            // wall clock passes it (it did — that is exactly what this guards).
            cacheExpiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
            updatedAt: new Date(Date.now() - 24 * 3600 * 1000),
          },
        ]),
      },
    };

    const result = await autopopulateCompanies({
      orgId: ORG_ID,
      userId: USER_ID,
      limit: 1,
      source: 'opportunities',
      prisma: prisma as never,
      log: logStub(),
    });

    expect(result.cached).toBe(1);
    expect(result.enriched).toBe(0);
    expect(mockedUpsert).not.toHaveBeenCalled();
    expect(mockedQueueApollo).not.toHaveBeenCalled();
  });
});

describe('isFreshCompanyEnrichment', () => {
  it('treats cached company data older than the weekly refresh window as stale', () => {
    const now = new Date('2026-06-07T00:00:00.000Z');

    expect(
      isFreshCompanyEnrichment(
        {
          logoUrl: 'https://cached.example/favicon.ico',
          cacheExpiresAt: new Date('2026-06-14T00:00:01.000Z'),
          confidenceBps: 8200,
        } as never,
        now,
      ),
    ).toBe(true);

    expect(
      isFreshCompanyEnrichment(
        {
          logoUrl: 'https://cached.example/favicon.ico',
          cacheExpiresAt: new Date('2026-06-06T23:59:59.000Z'),
          confidenceBps: 8200,
        } as never,
        now,
      ),
    ).toBe(false);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildCompanies, fallbackCompany, serializeCompany } from './company-enrichment.service.js';
import { canQueueApolloEnrichment } from './enrichment.service.js';

describe('canQueueApolloEnrichment', () => {
  it('requires complete Apollo MCP credentials before queueing the MCP lane', () => {
    expect(
      canQueueApolloEnrichment({
        env: {
          APOLLO_MCP_URL: 'https://mcp.apollo.test/mcp',
          APOLLO_MCP_BEARER_TOKEN: 'token',
        },
      }),
    ).toBe(true);

    expect(
      canQueueApolloEnrichment({
        env: {
          APOLLO_MCP_URL: 'https://mcp.apollo.test/mcp',
        },
      }),
    ).toBe(false);
  });

  it('uses Apollo REST only when an API key and domain are available', () => {
    expect(
      canQueueApolloEnrichment({
        domain: 'acme.com',
        env: { APOLLO_API_KEY: 'apollo-key' },
      }),
    ).toBe(true);
    expect(canQueueApolloEnrichment({ env: { APOLLO_API_KEY: 'apollo-key' } })).toBe(false);
  });
});

describe('serializeCompany', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('recomputes Apollo strategic-intel freshness from last sync time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-07T12:00:00.000Z'));

    const company = serializeCompany({
      id: 'acme',
      tradeName: 'Acme',
      legalName: 'Acme',
      domain: 'acme.com',
      website: 'https://acme.com/',
      industryCodes: ['Technology'],
      providerMetadata: {
        apollo: {
          strategicIntel: {
            provider: 'apollo_io',
            lastSyncedAt: '2026-05-29T12:00:00.000Z',
            syncMode: 'apollo_mcp_company_search',
            creditPolicy: 'free_search',
            freshness: 'fresh',
            employeeTrend: 'unknown',
            employeeCount: 500,
            annualRevenueMicros: null,
            intentTopics: [],
            hiringSignals: [],
            leadershipSignals: [],
            revenueSignals: [],
            newsSignals: [],
            summary: 'Apollo synced company profile.',
            limitations: [],
            signals: [],
          },
        },
      },
      employeeCount: 500,
      annualRevenueMicros: null,
      status: 'active',
      registryIds: {},
      formerNames: [],
      incorporationDate: null,
      logoUrl: 'https://acme.com/favicon.ico',
      logoSource: 'favicon',
      confidenceBps: 8500,
      sourceAttribution: [],
      updatedAt: new Date('2026-06-07T12:00:00.000Z'),
    });

    expect(company.strategicIntel?.freshness).toBe('stale');
  });

  it('maps Seamless technologies into the company technical stack', () => {
    const company = serializeCompany({
      id: 'sanofi',
      tradeName: 'Sanofi',
      legalName: 'Sanofi',
      domain: 'sanofi.com',
      website: 'https://sanofi.com/',
      industryCodes: ['Pharmaceuticals'],
      providerMetadata: {
        openCompanyProfile: {
          seamless: {
            technologies: ['SAP', 'Salesforce'],
          },
        },
      },
      employeeCount: 10001,
      annualRevenueMicros: null,
      status: 'active',
      registryIds: {},
      formerNames: [],
      incorporationDate: null,
      logoUrl: 'https://sanofi.com/favicon.ico',
      logoSource: 'favicon',
      confidenceBps: 9000,
      sourceAttribution: [],
      updatedAt: new Date('2026-06-07T12:00:00.000Z'),
    });

    expect(company.technicalStack).toEqual([
      {
        label: 'Seamless technologies',
        items: [
          { name: 'SAP', source: 'enrichment:seamless', confidence: null },
          { name: 'Salesforce', source: 'enrichment:seamless', confidence: null },
        ],
      },
    ]);
  });

  it('preserves a single Tech Intel MCP provider label in technical stack provenance', () => {
    const company = serializeCompany({
      id: 'acme',
      tradeName: 'Acme',
      legalName: 'Acme',
      domain: 'acme.com',
      website: 'https://acme.com/',
      industryCodes: ['Technology'],
      providerMetadata: {
        techStackMcp: {
          provider: 'BuiltWith MCP',
          technologies: ['Cloudflare', 'Segment'],
        },
      },
      employeeCount: 500,
      annualRevenueMicros: null,
      status: 'active',
      registryIds: {},
      formerNames: [],
      incorporationDate: null,
      logoUrl: 'https://acme.com/favicon.ico',
      logoSource: 'favicon',
      confidenceBps: 8600,
      sourceAttribution: [],
      updatedAt: new Date('2026-06-07T12:00:00.000Z'),
    });

    expect(company.technicalStack).toEqual([
      {
        label: 'BuiltWith MCP technologies',
        items: [
          {
            name: 'Cloudflare',
            source: 'enrichment:tech_stack_mcp:builtwith_mcp',
            confidence: null,
          },
          {
            name: 'Segment',
            source: 'enrichment:tech_stack_mcp:builtwith_mcp',
            confidence: null,
          },
        ],
      },
    ]);
  });

  it('maps multiple Tech Intel MCP providers into separate reviewable stack categories', () => {
    const company = serializeCompany({
      id: 'acme',
      tradeName: 'Acme',
      legalName: 'Acme',
      domain: 'acme.com',
      website: 'https://acme.com/',
      industryCodes: ['Technology'],
      providerMetadata: {
        techStackMcps: [
          {
            provider: 'BuiltWith MCP',
            technologies: ['Cloudflare', 'Segment'],
          },
          {
            provider: 'Wappalyzer MCP',
            technologies: ['Segment', 'Datadog'],
          },
        ],
      },
      employeeCount: 500,
      annualRevenueMicros: null,
      status: 'active',
      registryIds: {},
      formerNames: [],
      incorporationDate: null,
      logoUrl: 'https://acme.com/favicon.ico',
      logoSource: 'favicon',
      confidenceBps: 8600,
      sourceAttribution: [],
      updatedAt: new Date('2026-06-07T12:00:00.000Z'),
    });

    expect(company.technicalStack).toEqual([
      {
        label: 'BuiltWith MCP technologies',
        items: [
          {
            name: 'Cloudflare',
            source: 'enrichment:tech_stack_mcp:builtwith_mcp',
            confidence: null,
          },
          {
            name: 'Segment',
            source: 'enrichment:tech_stack_mcp:builtwith_mcp',
            confidence: null,
          },
        ],
      },
      {
        label: 'Wappalyzer MCP technologies',
        items: [
          {
            name: 'Datadog',
            source: 'enrichment:tech_stack_mcp:wappalyzer_mcp',
            confidence: null,
          },
        ],
      },
    ]);
  });

  it('merges Apollo and Seamless technical stack sources without duplicate vendors', () => {
    const company = serializeCompany({
      id: 'acme',
      tradeName: 'Acme',
      legalName: 'Acme',
      domain: 'acme.com',
      website: 'https://acme.com/',
      industryCodes: ['Technology'],
      providerMetadata: {
        meetingTechStack: [
          {
            label: 'Apollo technologies',
            items: [
              { name: 'Salesforce', source: 'apollo_io', confidence: 0.82 },
              { name: 'Snowflake', source: 'apollo_io', confidence: 0.82 },
            ],
          },
        ],
        openCompanyProfile: {
          seamless: {
            technologies: ['Salesforce', 'SAP'],
          },
        },
      },
      employeeCount: 500,
      annualRevenueMicros: null,
      status: 'active',
      registryIds: {},
      formerNames: [],
      incorporationDate: null,
      logoUrl: 'https://acme.com/favicon.ico',
      logoSource: 'favicon',
      confidenceBps: 8500,
      sourceAttribution: [],
      updatedAt: new Date('2026-06-07T12:00:00.000Z'),
    });

    const names = company.technicalStack?.flatMap((category) =>
      category.items.map((item) => item.name),
    );
    expect(new Set(names)).toEqual(new Set(['Salesforce', 'Snowflake', 'SAP']));
    expect(names?.filter((name) => name === 'Salesforce')).toHaveLength(1);
  });
});

describe('unscored company shells', () => {
  it('does not turn an opportunity customer name into a confidence score', () => {
    const [company] = buildCompanies(
      [
        {
          customer: 'Northwind',
          industry: 'logistics',
          logoUrl: null,
          updatedAt: new Date('2026-06-07T12:00:00.000Z'),
        },
      ],
      [],
      [],
    ).filter((row) => row.name === 'Northwind');

    expect(company?.legalName).toBeNull();
    expect(company?.confidence).toBeNull();
    expect(company?.sourceAttribution[0]?.confidence).toBeNull();
    expect(company?.sourceAttribution[0]?.providerMetadata.confidenceBasis).toBe('not_scored');
    expect(company?.employeeCount).toBeNull();
    expect(company?.annualRevenueMicros).toBeNull();
    expect(company?.domain).toBeNull();
    expect(company?.website).toBeNull();
  });

  it('keeps a stored public logo when the company row has no logo of its own', () => {
    const [company] = buildCompanies(
      [],
      [
        {
          id: 'enrich-1',
          tradeName: 'DNB Bank',
          legalName: 'DNB Bank ASA',
          domain: 'dnb.no',
          website: 'https://www.dnb.no/',
          industryCodes: ['financial services'],
          providerMetadata: {
            publicFacts: {
              description: 'DNB Bank is a Norwegian bank.',
              headquarters: 'Oslo, Norway',
              chiefExecutive: 'Rune Bjerke',
              stockExchange: 'Oslo Stock Exchange',
              revenueLabel: '54,857,000,000 NOK',
              revenueCurrency: 'NOK',
            },
          },
          employeeCount: 9020,
          annualRevenueMicros: null,
          status: 'active',
          registryIds: {},
          formerNames: [],
          incorporationDate: null,
          logoUrl: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/DNB_Logo.svg',
          logoSource: 'wikimedia',
          confidenceBps: 8000,
          sourceAttribution: [],
          updatedAt: new Date('2026-06-07T12:00:00.000Z'),
        },
      ],
      [
        {
          id: 'company-1',
          name: 'DNB Bank',
          domain: 'dnb.no',
          logoUrl: null,
          legalName: 'DNB Bank',
        },
      ],
    );

    expect(company?.logo.url).toContain('DNB_Logo.svg');
    expect(company?.logo.source).toBe('wikimedia');
    expect(company?.id).toBe('company-1');
    expect(company?.publicFacts?.headquarters).toBe('Oslo, Norway');
    expect(company?.employeeCount).toBe(9020);
    expect(company?.legalName).toBe('DNB Bank ASA');
    expect(company?.legalNameSource).toBe('public');
  });

  it('lets a saved account legal name replace the public official name', () => {
    const [company] = buildCompanies(
      [],
      [
        {
          id: 'enrich-1',
          tradeName: 'DNB Bank',
          legalName: 'DNB Bank ASA',
          domain: 'dnb.no',
          website: 'https://www.dnb.no/',
          industryCodes: ['financial services'],
          providerMetadata: {
            publicFacts: {
              description: 'DNB Bank is a Norwegian bank.',
              headquarters: 'Oslo, Norway',
              chiefExecutive: null,
              stockExchange: null,
              revenueLabel: null,
              revenueCurrency: null,
            },
          },
          employeeCount: null,
          annualRevenueMicros: null,
          status: 'active',
          registryIds: {},
          formerNames: [],
          incorporationDate: null,
          logoUrl: null,
          logoSource: null,
          confidenceBps: 0,
          sourceAttribution: [],
          updatedAt: new Date('2026-06-07T12:00:00.000Z'),
        },
      ],
      [
        {
          id: 'company-1',
          name: 'DNB Bank',
          domain: 'dnb.no',
          logoUrl: null,
          legalName: 'DNB Bank Group',
        },
      ],
    );

    expect(company?.legalName).toBe('DNB Bank Group');
    expect(company?.legalNameSource).toBe('account');
  });

  it('does not present a meeting-note name as a legal name', () => {
    // WHY: the enrichment column cannot be empty, so an import stores the
    // typed company name there. Without public facts that string is not a
    // registry name.
    const [company] = buildCompanies(
      [],
      [
        {
          id: 'enrich-meeting',
          tradeName: 'Linked Import',
          legalName: 'Linked Import',
          domain: null,
          website: null,
          industryCodes: [],
          providerMetadata: { meetingTechStack: [] },
          employeeCount: null,
          annualRevenueMicros: null,
          status: null,
          registryIds: {},
          formerNames: [],
          incorporationDate: null,
          logoUrl: null,
          logoSource: null,
          confidenceBps: 0,
          sourceAttribution: [],
          updatedAt: new Date('2026-11-01T00:00:00.000Z'),
        },
      ],
      [],
    );
    expect(company?.name).toBe('Linked Import');
    expect(company?.legalName).toBeNull();
    expect(company?.legalNameSource).toBeNull();
  });

  it('does not invent Mantu headcount or revenue on the placeholder account', () => {
    const mantu = fallbackCompany('Mantu');
    expect(mantu.legalName).toBeNull();
    expect(mantu.confidence).toBeNull();
    expect(mantu.employeeCount).toBeNull();
    expect(mantu.annualRevenueMicros).toBeNull();
    expect(mantu.domain).toBeNull();
    expect(mantu.website).toBeNull();
    expect(mantu.logo.url).toBeNull();
  });
});

describe('stored public revenue', () => {
  it('keeps a large revenue as text instead of a rounded number', () => {
    // WHY: Number(54_857_000_000_000_000n) is not the stored integer.
    const company = serializeCompany({
      id: 'enrich-dnb',
      tradeName: 'DNB Bank',
      legalName: 'DNB Bank ASA',
      domain: 'dnb.no',
      website: 'https://www.dnb.no/',
      industryCodes: ['financial services'],
      providerMetadata: {},
      employeeCount: 9020,
      annualRevenueMicros: 54_857_000_000_000_000n,
      status: 'active',
      registryIds: {},
      formerNames: [],
      incorporationDate: null,
      logoUrl: null,
      logoSource: null,
      confidenceBps: 0,
      sourceAttribution: [],
      updatedAt: new Date('2026-06-07T12:00:00.000Z'),
    });
    expect(company.annualRevenueMicros).toBeNull();
    expect(company.annualRevenueMicrosText).toBe('54857000000000000');
  });
});

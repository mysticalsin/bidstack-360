import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildCompanies, serializeCompany } from './company-enrichment.service.js';
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

describe('buildCompanies', () => {
  // A brand-new org has no opportunities and no enrichments. The accounts page
  // renders this list as the book, so a hardcoded home account would look like
  // a real customer (headcount, revenue, confidence) before the first import.
  it('does not invent a Mantu account when the org has no companies', () => {
    const companies = buildCompanies([], [], []);
    expect(companies.map((company) => company.name)).toEqual([]);
  });

  it('keeps a real customer named Mantu when that account is actually in the book', () => {
    const companies = buildCompanies(
      [
        {
          customer: 'Mantu',
          industry: 'consulting',
          logoUrl: null,
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ],
      [],
      [],
    );
    expect(companies.map((company) => company.name)).toEqual(['Mantu']);
    expect(companies[0]?.employeeCount).toBeNull();
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
          { name: 'SAP', source: 'enrichment:seamless', confidence: 0.9 },
          { name: 'Salesforce', source: 'enrichment:seamless', confidence: 0.9 },
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
            confidence: 0.86,
          },
          {
            name: 'Segment',
            source: 'enrichment:tech_stack_mcp:builtwith_mcp',
            confidence: 0.86,
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
            confidence: 0.86,
          },
          {
            name: 'Segment',
            source: 'enrichment:tech_stack_mcp:builtwith_mcp',
            confidence: 0.86,
          },
        ],
      },
      {
        label: 'Wappalyzer MCP technologies',
        items: [
          {
            name: 'Datadog',
            source: 'enrichment:tech_stack_mcp:wappalyzer_mcp',
            confidence: 0.86,
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

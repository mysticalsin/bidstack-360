import { afterEach, describe, expect, it, vi } from 'vitest';

import { serializeCompany } from './company-enrichment.service.js';

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
});

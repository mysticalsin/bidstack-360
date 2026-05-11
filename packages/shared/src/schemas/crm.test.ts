import { describe, expect, it } from 'vitest';

import {
  CompanyLookupResponse,
  CrmCompany,
  CrmConnector,
  CrmDashboardSnapshot,
  DataQualityReport,
  DustCrmToolName,
  OpenDataSignalsResponse,
  SalesIntelligenceReport,
} from './crm.js';

const fetchedAt = '2026-05-11T00:00:00.000Z';

describe('CRM schemas', () => {
  it('accepts a Mantu company profile with official logo attribution', () => {
    const company = CrmCompany.parse({
      id: 'mantu',
      source: 'enrichment',
      name: 'Mantu',
      legalName: 'Mantu',
      domain: 'mantu.com',
      website: 'https://mantu.com/',
      industry: 'consulting',
      employeeCount: 12000,
      annualRevenueMicros: 1_000_000_000_000_000,
      status: 'active',
      registryIds: {},
      formerNames: [],
      incorporationDate: null,
      logo: {
        url: 'https://mantu.com/favicon.ico',
        source: 'official_website',
        cachedAt: fetchedAt,
        attribution: {
          source: 'official_website',
          label: 'Mantu official website',
          sourceUrl: 'https://mantu.com/',
          fetchedAt,
          confidence: 0.99,
          providerMetadata: {},
        },
      },
      confidence: 0.99,
      sourceAttribution: [],
      updatedAt: fetchedAt,
    });

    expect(company.logo?.source).toBe('official_website');
    expect(company.domain).toBe('mantu.com');
  });

  it('keeps the requested Dust MCP crm_* tool names stable', () => {
    expect(DustCrmToolName.options).toEqual([
      'crm_search_companies',
      'crm_create_deal',
      'crm_update_deal',
      'crm_enrich_company',
      'crm_list_activities',
      'crm_create_activity',
      'crm_generate_insights',
    ]);
  });

  it('requires release-score and source-rich dashboard data', () => {
    const dashboard = CrmDashboardSnapshot.partial().safeParse({
      generatedAt: fetchedAt,
      releaseScore: {
        functional: 24,
        code: 24,
        design: 24,
        infra: 23,
        total: 95,
        passed: true,
        scoredAt: fetchedAt,
      },
    });

    expect(dashboard.success).toBe(true);
  });

  it('describes company lookup and data-quality contracts', () => {
    expect(
      CompanyLookupResponse.safeParse({
        match: 'exact_domain',
        company: null,
        alternatives: [],
      }).success,
    ).toBe(true);

    const report = DataQualityReport.parse({
      generatedAt: fetchedAt,
      counts: { stale_enrichment: 1 },
      issues: [
        {
          id: 'stale-enrichment:mantu',
          kind: 'stale_enrichment',
          severity: 'low',
          title: 'Mantu enrichment is older than 90 days',
          detail: null,
          companyId: 'mantu',
          companyName: 'Mantu',
          sourceAttribution: [],
        },
      ],
    });
    expect(report.counts.stale_enrichment).toBe(1);
  });

  it('separates open APIs from credentialed or widget-only connectors', () => {
    const connector = CrmConnector.parse({
      id: 'tradingview-widgets',
      name: 'TradingView Widgets',
      category: 'market',
      kind: 'official_widget',
      status: 'healthy',
      requiresCredential: false,
      sourceUrl: 'https://www.tradingview.com/widget-docs/',
      docsUrl: 'https://www.tradingview.com/widget-docs/faq/data/',
      lastCheckedAt: fetchedAt,
      message: 'Official embeddable widgets; no raw data API.',
      capabilities: ['market widgets', 'symbol detail widgets'],
    });

    expect(connector.kind).toBe('official_widget');
    expect(connector.requiresCredential).toBe(false);

    const signals = OpenDataSignalsResponse.parse({
      generatedAt: fetchedAt,
      connectors: [connector],
      signals: [],
    });
    expect(signals.connectors[0]?.id).toBe('tradingview-widgets');
  });

  it('captures Odoo-style sales numbers with country and contact context', () => {
    const report = SalesIntelligenceReport.parse({
      generatedAt: fetchedAt,
      currencyCode: 'CAD',
      source: 'opportunities',
      sourceAttribution: [
        {
          source: 'twenty_compatible_opportunities',
          label: 'Twenty-compatible BidStack opportunity pipeline',
          sourceUrl: null,
          fetchedAt,
          confidence: 0.78,
          providerMetadata: { fallback: true },
        },
      ],
      kpis: [
        {
          id: 'quotations',
          label: 'Quotations',
          kind: 'count',
          value: 46,
          currencyCode: null,
          percentChange: 52,
          trend: 'up',
          tone: 'blue',
        },
      ],
      monthlySales: [
        {
          month: '2026-04',
          label: 'Apr 2026',
          revenueMicros: 118_000_000_000,
          quotationCount: 8,
          orderCount: 5,
        },
      ],
      topQuotations: [],
      topOrders: [],
      topCountries: [
        {
          countryCode: 'CA',
          countryName: 'Canada',
          revenueMicros: 118_000_000_000,
          quotationCount: 8,
          orderCount: 5,
          customerCount: 3,
          topCustomers: ['CI Financial'],
          people: [
            {
              name: 'Michael Johnson',
              title: 'Chief Information Officer',
              email: 'mjohnson@ci.com',
              customer: 'CI Financial',
            },
          ],
          salespeople: ['Jane Smith'],
          sharePct: 100,
        },
      ],
      topProducts: [],
      topCategories: [],
    });

    expect(report.topCountries[0]?.people[0]?.customer).toBe('CI Financial');
  });
});

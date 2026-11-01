import { afterEach, describe, expect, it } from 'vitest';

import { mapStoredInsights } from './dashboard.cockpit.js';
import * as dashboardDefaults from './dashboard.defaults.js';
import { defaultQueueHealth } from './dashboard.defaults.js';
import { defaultProviderHealth } from './dashboard.providers.js';
import { serializeDeal } from './dashboard.queries.js';
import { asProviderStatus, formatMicrosCompact } from './dashboard.utils.js';

const ENV_KEYS = [
  'APOLLO_API_KEY',
  'APOLLO_MCP_URL',
  'APOLLO_MCP_BEARER_TOKEN',
  'SAM_GOV_API_KEY',
  'SILLAGE_API_KEY',
  'SILLAGE_MCP_URL',
  'GMAIL_CLIENT_ID',
  'COMPANIES_HOUSE_API_KEY',
] as const;
const envSnapshot = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of ENV_KEYS) {
    const previous = envSnapshot[key];
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
});

describe('account catalogs are not shipped as fallbacks', () => {
  it('does not export a sample tech stack, demo bid, risk, or compliance row', () => {
    // WHY: these factories used to fill every account with Microsoft 365,
    // a SAM.gov demo opportunity, and SOC 2 marked compliant.
    const exports = dashboardDefaults as Record<string, unknown>;
    expect(exports.defaultTechnicalStack).toBeUndefined();
    expect(exports.defaultBidOpportunities).toBeUndefined();
    expect(exports.defaultRisks).toBeUndefined();
    expect(exports.defaultCompliance).toBeUndefined();
  });
});

describe('queue health is not an invented idle snapshot', () => {
  it('returns no rows when nothing has been checked', () => {
    expect(defaultQueueHealth()).toEqual([]);
  });
});

describe('dashboard insights are stored rows only', () => {
  it('does not invent a stagnation or upsell score when nothing is stored', () => {
    expect(mapStoredInsights([])).toEqual([]);
  });

  it('uses the stored basis points instead of a fixed model score', () => {
    const [insight] = mapStoredInsights([
      {
        id: 'insight-1',
        kind: 'next_best_action',
        title: 'Recorded note',
        summary: 'The owner wrote this down.',
        confidenceBps: 4000,
        companyName: 'DNB Bank',
        opportunityId: null,
        sourceAttribution: [],
        createdAt: new Date('2026-06-01T00:00:00.000Z'),
      },
    ]);
    expect(insight?.confidence).toBe(0.4);
    expect(insight?.title).toBe('Recorded note');
    expect(insight?.companyName).toBe('DNB Bank');
    expect(insight?.companyId).toBeNull();
    expect(JSON.stringify(insight)).not.toContain('Deal stagnation');
    expect(JSON.stringify(insight)).not.toContain('dnb-bank');
  });

  it('copies the company id from the linked opportunity, not from the stored name', () => {
    // Why: the customer name used to be normalized into companyId, so an
    // insight looked attached to an account that was only a label.
    const [insight] = mapStoredInsights(
      [
        {
          id: 'insight-2',
          kind: 'account_risk',
          title: 'Residency',
          summary: 'Recorded against the treasury opportunity.',
          confidenceBps: 0,
          companyName: 'DNB',
          opportunityId: 'opp-1',
          sourceAttribution: [],
          createdAt: new Date('2026-06-01T00:00:00.000Z'),
        },
      ],
      new Map([['opp-1', 'co-dnb']]),
    );
    expect(insight?.companyId).toBe('co-dnb');
    expect(insight?.companyName).toBe('DNB');
  });
});

describe('provider health is not a configured-means-healthy probe', () => {
  it('does not report a fake healthy latency for core providers', () => {
    // WHY: Dust and the dashboard were reading "healthy / 42ms" from the
    // default row whenever the process was up or DUST_API_KEY was set.
    // Configuration is not a live probe, so the default must say unverified.
    const rows = defaultProviderHealth();
    for (const provider of ['External CRM GraphQL', 'Dust REST']) {
      const row = rows.find((item) => item.provider === provider);
      expect(row?.status).toBe('unverified');
      expect(row?.latencyMs).toBeNull();
      expect(row?.message?.toLowerCase()).toContain('not a live probe');
      expect(row?.message).not.toMatch(/normal health response/i);
    }
  });

  it('does not mark the other catalog rows healthy just because configuration exists', () => {
    // WHY: SEC, Wikidata, USAspending, and TradingView were hardcoded healthy,
    // and Apollo/SAM/Sillage flipped to healthy when an env var was set.
    // None of those paths place a live call.
    process.env.APOLLO_API_KEY = 'configured';
    process.env.SAM_GOV_API_KEY = 'configured';
    process.env.SILLAGE_API_KEY = 'configured';
    process.env.GMAIL_CLIENT_ID = 'configured';
    const rows = defaultProviderHealth();
    const openRows = ['SEC EDGAR', 'Wikidata + Wikimedia Commons', 'USAspending', 'TradingView Widgets'];
    const configuredRows = ['Apollo Organizations', 'SAM.gov', 'Sillage Buying Signals', 'Gmail'];
    for (const provider of [...openRows, ...configuredRows]) {
      const row = rows.find((item) => item.provider === provider);
      expect(row?.status, provider).toBe('unverified');
      expect(row?.latencyMs, provider).toBeNull();
      expect(row?.message?.toLowerCase() ?? '', provider).not.toMatch(/healthy|connection active/);
    }
    expect(rows.some((row) => row.status === 'healthy')).toBe(false);
    expect(rows.every((row) => row.latencyMs === null)).toBe(true);
  });

  it('keeps unverified as its own status instead of folding it into degraded', () => {
    expect(asProviderStatus('unverified')).toBe('unverified');
    expect(asProviderStatus('not-a-status')).toBe('degraded');
  });
});

describe('company revenue is not printed as dollars', () => {
  it('keeps a compact revenue figure unspecified when no currency was stored', () => {
    // Why: annualRevenueMicros has no currency column. "$2.0M" on the account
    // cockpit was a dollar sign beside an unspecified amount.
    const label = formatMicrosCompact(2_000_000_000_000);
    expect(label).toBe('2M unspecified');
    expect(label).not.toMatch(/[$€]|EUR|USD/);
  });
});

describe('deal currency is omitted when the opportunity has none', () => {
  it('returns null instead of a hardcoded EUR code', () => {
    // WHY: the opportunity table has no currency column. Labeling every
    // pipeline total as EUR made Dust and the dashboard present an unspecified
    // sum as a euro forecast.
    const deal = serializeDeal({
      id: '6b1b3a2e-1c4d-4e5f-8a9b-0c1d2e3f4a5b',
      customer: 'Acme',
      name: 'Renewal',
      stage: 's1_lead',
      pipelineStage: null,
      valueMicros: 1_000_000,
      probability: 40,
      dueDate: null,
      ownerId: null,
      owner: null,
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    expect(deal.currencyCode).toBeNull();
    expect(deal.companyId).toBeNull();
    expect(deal.companyName).toBe('Acme');
  });

  it('keeps the company id only when the opportunity row stores one', () => {
    // Why: the customer name used to be normalized into companyId, so a deal
    // with no company link still looked attached to an account.
    const deal = serializeDeal({
      id: '6b1b3a2e-1c4d-4e5f-8a9b-0c1d2e3f4a5b',
      customer: 'DNB',
      companyId: 'c0000000-0000-4000-8000-000000000008',
      name: 'Renewal',
      stage: 's1_lead',
      pipelineStage: null,
      valueMicros: 1_000_000,
      probability: 40,
      dueDate: null,
      ownerId: null,
      owner: null,
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    expect(deal.companyId).toBe('c0000000-0000-4000-8000-000000000008');
    expect(deal.companyName).toBe('DNB');
  });

  it('keeps a lost stage flag out of the open account pipeline', () => {
    // Why: a custom stage key mapped to "new". The account list then counted
    // a lost deal's value as open pipeline.
    const flagged = serializeDeal({
      id: '6b1b3a2e-1c4d-4e5f-8a9b-0c1d2e3f4a5b',
      customer: 'Acme',
      name: 'Price loss',
      stage: 's3_technical_iteration',
      pipelineStage: {
        key: 'price_lost',
        name: 'Price lost',
        probability: 0,
        color: null,
        isWon: false,
        isLost: true,
      },
      valueMicros: 1_000_000,
      probability: 40,
      dueDate: null,
      ownerId: null,
      owner: null,
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    expect(flagged.stage).toBe('closed_lost');

    const enumLost = serializeDeal({
      id: '6b1b3a2e-1c4d-4e5f-8a9b-0c1d2e3f4a5c',
      customer: 'Acme',
      name: 'Closed on the enum',
      stage: 'closed_lost',
      pipelineStage: {
        key: 's4_negotiation',
        name: 'S4 Negotiation',
        probability: 80,
        color: null,
        isWon: false,
        isLost: false,
      },
      valueMicros: 1_000_000,
      probability: 80,
      dueDate: null,
      ownerId: null,
      owner: null,
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    expect(enumLost.stage).toBe('closed_lost');
  });

  it('keeps a deleted stage from closing the deal', () => {
    // WHY: the stage row was still joined after it was deleted, so a removed
    // lost flag kept the bid out of the open account list.
    const deal = serializeDeal({
      id: '6b1b3a2e-1c4d-4e5f-8a9b-0c1d2e3f4a5d',
      customer: 'Acme',
      name: 'Back in play',
      stage: 's2_sent',
      pipelineStage: {
        key: 'price_lost',
        name: 'Price lost',
        probability: 0,
        color: null,
        isWon: false,
        isLost: true,
        deletedAt: new Date('2026-02-01T00:00:00.000Z'),
      },
      valueMicros: 1_000_000,
      probability: 40,
      dueDate: null,
      ownerId: null,
      owner: null,
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    expect(deal.stage).toBe('meeting');
  });
});

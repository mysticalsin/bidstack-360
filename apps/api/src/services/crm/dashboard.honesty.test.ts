import { afterEach, describe, expect, it } from 'vitest';

import { defaultProviderHealth } from './dashboard.providers.js';
import { serializeDeal } from './dashboard.queries.js';
import { asProviderStatus } from './dashboard.utils.js';

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
  });
});

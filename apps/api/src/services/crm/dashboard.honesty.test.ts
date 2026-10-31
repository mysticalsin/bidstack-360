import { describe, expect, it } from 'vitest';

import { defaultProviderHealth } from './dashboard.providers.js';
import { serializeDeal } from './dashboard.queries.js';
import { asProviderStatus } from './dashboard.utils.js';

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

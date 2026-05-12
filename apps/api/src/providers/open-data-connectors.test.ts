import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildConnectorCatalog,
  buildOpenDataSignals,
  fetchSecTickerSignal,
  fetchUsaSpendingSignals,
} from './open-data-connectors.js';

const now = new Date('2026-05-11T00:00:00.000Z');
const apolloKey = process.env.APOLLO_API_KEY;

afterEach(() => {
  if (apolloKey === undefined) {
    delete process.env.APOLLO_API_KEY;
  } else {
    process.env.APOLLO_API_KEY = apolloKey;
  }
});

describe('open data connectors', () => {
  it('marks open, credentialed, and widget-only providers honestly', () => {
    delete process.env.APOLLO_API_KEY;

    const connectors = buildConnectorCatalog(now);

    expect(connectors.find((c) => c.id === 'sec-edgar')).toMatchObject({
      kind: 'open_api',
      status: 'healthy',
      requiresCredential: false,
    });
    expect(connectors.find((c) => c.id === 'wikidata-wikimedia')).toMatchObject({
      kind: 'open_api',
      status: 'healthy',
      requiresCredential: false,
    });
    expect(connectors.find((c) => c.id === 'tradingview-widgets')).toMatchObject({
      kind: 'official_widget',
      status: 'healthy',
      requiresCredential: false,
    });
    expect(connectors.find((c) => c.id === 'apollo-organizations')).toMatchObject({
      kind: 'credentialed_api',
      status: 'disabled',
      requiresCredential: true,
    });
  });

  it('maps SEC ticker data into a source-attributed signal', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            0: { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' },
          }),
          { status: 200 },
        ),
    );

    const signal = await fetchSecTickerSignal('AAPL', now, fetchImpl);

    expect(signal).toMatchObject({
      provider: 'SEC EDGAR',
      title: 'Apple Inc. is mapped to AAPL',
      metadata: { cik: '0000320193', ticker: 'AAPL' },
    });
    expect(signal?.sourceAttribution[0]?.source).toBe('sec_edgar');
  });

  it('maps USAspending awards into funding signals', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            results: [
              {
                'Award ID': 'CONT_A',
                'Recipient Name': 'Mantu',
                'Award Amount': 1250000,
                'Awarding Agency': 'General Services Administration',
              },
            ],
          }),
          { status: 200 },
        ),
    );

    const signals = await fetchUsaSpendingSignals('Mantu', now, fetchImpl);

    expect(signals[0]).toMatchObject({
      provider: 'USAspending',
      title: 'Mantu award signal',
      metadata: { awardId: 'CONT_A', awardAmount: 1250000 },
    });
    expect(signals[0]?.sourceAttribution[0]?.source).toBe('usaspending');
  });

  it('keeps widget data visible when public APIs are unavailable', async () => {
    const fetchImpl = vi.fn(async () => new Response('rate limited', { status: 429 }));

    const signals = await buildOpenDataSignals({
      query: 'Mantu',
      ticker: 'MTU',
      now,
      fetchImpl,
    });

    expect(signals.map((signal) => signal.provider)).toContain('TradingView Widgets');
  });

  it('does not treat exchange-prefixed market symbols as SEC ticker matches', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));

    const signals = await buildOpenDataSignals({
      ticker: 'TSX:CIX',
      now,
      fetchImpl,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(signals).toEqual([
      expect.objectContaining({
        provider: 'TradingView Widgets',
        metadata: { integrationMode: 'official_widget', symbol: 'TSX:CIX' },
      }),
    ]);
  });
});

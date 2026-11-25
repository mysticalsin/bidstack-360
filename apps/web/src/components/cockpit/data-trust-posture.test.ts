import { describe, expect, it } from 'vitest';

import type { SourceAttribution } from '@bidstack/shared';

import { dataTrustPosture } from './data-trust-posture';

function receipt(source: string, confidence = 0.5): SourceAttribution {
  return {
    source,
    label: source,
    sourceUrl: null,
    fetchedAt: '2026-11-01T00:00:00.000Z',
    confidence,
    providerMetadata: {},
  };
}

describe('dataTrustPosture', () => {
  it('drops the four receipts the cockpit synthesizes and keeps a fetched source', () => {
    // WHY: these four strings are written when no external fetch exists
    // (opportunity stub, sparse company row, name fallback, demo seed).
    // A later Apollo receipt must still count, and must not be averaged
    // with the seed confidence beside it.
    const posture = dataTrustPosture([
      receipt('external_crm', 0.55),
      receipt('bidstack', 0.5),
      receipt('bidstack_seed', 0.5),
      receipt('seed_verified_profile', 0.87),
      receipt('apollo_io', 0.92),
    ]);

    expect(posture.realSources.map((source) => source.source)).toEqual(['apollo_io']);
    expect(posture.confidence).toBe(0.92);
    expect(posture.latestFetch).toBe('2026-11-01T00:00:00.000Z');
  });

  it('returns no confidence when every receipt is a placeholder', () => {
    const posture = dataTrustPosture([receipt('external_crm', 0.55)]);
    expect(posture.confidence).toBeNull();
    expect(posture.latestFetch).toBeNull();
    expect(posture.realSources).toEqual([]);
  });
});

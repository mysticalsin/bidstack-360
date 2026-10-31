import { describe, expect, it } from 'vitest';

import { presentOpportunityIntel } from './present-opportunity-intel.js';

const fixtureDossier = {
  refreshedAt: '2026-05-10T08:00:00.000Z',
  financial: {
    ticker: null,
    marketCap: null,
    revenueAnnual: null,
    revenueGrowth: 0.06,
    ebitdaMargin: 0.32,
    creditRating: null,
    headcount: 2500,
    headcountTrend: [],
    pricePoints: [],
  },
  triggers: [
    {
      id: 'OP-2048-t1',
      kind: 'funding' as const,
      label: 'Closed Series D — $80M',
      weight: 8,
      observedAt: '2026-04-15T00:00:00.000Z',
      source: 'Crunchbase',
    },
  ],
  competitors: [
    { vendor: 'Accenture', score: 72, strengths: ['Scale', 'Brand'], weaknesses: ['Cost'] },
    { vendor: 'DXC', score: 64, strengths: ['Local presence'], weaknesses: ['Tech depth'] },
  ],
  news: [
    {
      id: 'OP-2048-n1',
      headline: 'Customer announces digital transformation roadmap',
      source: 'Press release',
      publishedAt: '2026-04-22T00:00:00.000Z',
      sentiment: 'positive' as const,
      url: null,
    },
  ],
  hiring: {
    openings: [
      {
        title: 'VP Cloud Engineering',
        department: 'IT',
        urgency: 'high' as const,
        postedAt: '2026-05-01T00:00:00.000Z',
      },
    ],
    velocity: 1.2,
    trendDirection: 'up' as const,
  },
  winPrediction: {
    probability: 65,
    modelVersion: 'wp-baseline-0.1',
    drivers: [{ label: 'Champion strength', contribution: 18 }],
  },
};

describe('presentOpportunityIntel', () => {
  it('drops the copied seed dossier so a deal does not show a 65% win forecast', () => {
    // WHY: every seeded opportunity carried the same 65% prediction, Series D,
    // and competitor scores. Showing them on DNB reads as research that never ran.
    expect(presentOpportunityIntel(fixtureDossier)).toEqual({});
    expect(presentOpportunityIntel(null)).toEqual({});
  });

  it('keeps a trigger or prediction that is not the copied dossier', () => {
    const presented = presentOpportunityIntel({
      ...fixtureDossier,
      triggers: [
        ...fixtureDossier.triggers,
        {
          id: 'real-1',
          kind: 'press' as const,
          label: 'DNB names a new cloud lead',
          weight: 4,
          observedAt: '2026-06-01T00:00:00.000Z',
          source: 'Company filing',
        },
      ],
      winPrediction: {
        probability: 40,
        modelVersion: 'org-model-3',
        drivers: [{ label: 'Recorded stage age', contribution: -2 }],
      },
    });

    expect(presented.winPrediction?.modelVersion).toBe('org-model-3');
    expect(presented.triggers?.map((trigger) => trigger.label)).toEqual(['DNB names a new cloud lead']);
    expect(presented.competitors).toEqual([]);
    expect(presented.news).toEqual([]);
  });
});

// Demo bids such as Siemens ship with no intel payload. An empty financial
// shell is not a health report, and a 0 market cap is a measured figure.
import { describe, expect, it } from 'vitest';

import type { IntelPayload } from '@bidstack/shared';

import {
  opportunityIntelHasRecord,
  opportunityIntelSections,
} from './opportunity-intel-sections';

const BLANK_FINANCIAL: NonNullable<IntelPayload['financial']> = {
  ticker: null,
  marketCap: null,
  revenueAnnual: null,
  revenueGrowth: null,
  ebitdaMargin: null,
  creditRating: null,
  headcount: null,
  headcountTrend: [],
  pricePoints: [],
};

describe('opportunityIntelSections', () => {
  it('hides every intel card when the bid has no payload', () => {
    // WHY: the deal page was painting Financial health, Win prediction,
    // triggers, competitors, and news as dashes for Siemens. Nothing was queried.
    expect(opportunityIntelSections({})).toEqual({
      financial: false,
      winPrediction: false,
      triggers: false,
      competitors: false,
      news: false,
    });
    expect(opportunityIntelSections(null)).toEqual(opportunityIntelSections({}));
    expect(opportunityIntelHasRecord({})).toBe(false);
    expect(opportunityIntelHasRecord(null)).toBe(false);
  });

  it('does not treat an all-null financial shell as a report', () => {
    expect(opportunityIntelSections({ financial: BLANK_FINANCIAL }).financial).toBe(false);
    expect(opportunityIntelHasRecord({ financial: BLANK_FINANCIAL })).toBe(false);
  });

  it('keeps a measured zero and a real rating', () => {
    expect(
      opportunityIntelSections({
        financial: { ...BLANK_FINANCIAL, marketCap: 0 },
      }).financial,
    ).toBe(true);
    expect(
      opportunityIntelSections({
        financial: { ...BLANK_FINANCIAL, creditRating: 'A+' },
      }).financial,
    ).toBe(true);
  });

  it('shows only the cards that have a signal', () => {
    const sections = opportunityIntelSections({
      winPrediction: { probability: 0, modelVersion: 'demo', drivers: [] },
      news: [],
      triggers: [
        {
          id: 't1',
          kind: 'press',
          label: 'Plant expansion',
          weight: 4,
          observedAt: '2026-04-01T00:00:00.000Z',
          source: 'demo',
        },
      ],
    });
    expect(sections.winPrediction).toBe(true);
    expect(sections.triggers).toBe(true);
    expect(sections.news).toBe(false);
    expect(sections.financial).toBe(false);
    expect(sections.competitors).toBe(false);
  });

  it('counts a refresh, a decision unit, or hiring as a record without inventing cards', () => {
    expect(opportunityIntelHasRecord({ refreshedAt: '2026-04-01T00:00:00.000Z' })).toBe(true);
    expect(
      opportunityIntelSections({ refreshedAt: '2026-04-01T00:00:00.000Z' }).financial,
    ).toBe(false);
    expect(
      opportunityIntelHasRecord({
        decisionUnit: [
          {
            contactId: '00000000-0000-4000-8000-000000000001',
            name: 'Klaus Vogt',
            role: 'VP Operations',
            influence: 1,
            sentiment: 'hot',
            power: 'decision',
          },
        ],
      }),
    ).toBe(true);
    expect(
      opportunityIntelHasRecord({
        hiring: { openings: [], velocity: 0, trendDirection: 'flat' },
      }),
    ).toBe(false);
    expect(
      opportunityIntelHasRecord({
        hiring: {
          openings: [
            {
              title: 'Plant engineer',
              department: 'Ops',
              urgency: 'low',
              postedAt: '2026-04-01T00:00:00.000Z',
            },
          ],
          velocity: 1,
          trendDirection: 'up',
        },
      }),
    ).toBe(true);
  });
});

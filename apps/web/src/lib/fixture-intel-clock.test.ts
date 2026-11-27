import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { FIXTURE_INTEL_STAMPS, projectFixtureIntel } from './fixture-intel-clock.js';

const NOW = new Date('2026-11-27T12:00:00.000Z');
const LATER = new Date('2027-06-15T15:00:00.000Z');

function seededIntel(code = 'OP-2041') {
  return {
    refreshedAt: '2026-05-10T08:00:00.000Z',
    triggers: [
      {
        id: `${code}-t1`,
        kind: 'funding',
        label: 'Closed Series D — $80M',
        weight: 8,
        observedAt: '2026-04-15T00:00:00.000Z',
        source: 'Crunchbase',
      },
      {
        id: `${code}-t2`,
        kind: 'executive_move',
        label: 'New CTO appointed',
        weight: 7,
        observedAt: '2026-03-20T00:00:00.000Z',
        source: 'LinkedIn',
      },
      {
        id: `${code}-t3`,
        kind: 'regulatory',
        label: 'NIS2 deadline approaching',
        weight: 6,
        observedAt: '2026-05-01T00:00:00.000Z',
        source: 'EU register',
      },
    ],
    news: [
      {
        id: `${code}-n1`,
        headline: 'Customer announces digital transformation roadmap',
        source: 'Press release',
        publishedAt: '2026-04-22T00:00:00.000Z',
        sentiment: 'positive',
        url: null,
      },
    ],
    hiring: {
      openings: [
        {
          title: 'VP Cloud Engineering',
          department: 'IT',
          urgency: 'high',
          postedAt: '2026-05-01T00:00:00.000Z',
        },
      ],
    },
  };
}

describe('fixture deal intel clock', () => {
  it('moves the seeded refresh onto today and keeps the gaps between triggers and news', () => {
    // WHY: intelFor writes March–May 2026 stamps, and the seed update writes
    // them again. On 2026-11-27 the deal page still says the intel was
    // refreshed on 10 May and that a NIS2 deadline is approaching on 1 May.
    const intel = seededIntel();
    const slid = projectFixtureIntel(intel, NOW, 'demo');

    expect(slid.refreshedAt).toBe('2026-11-27T08:00:00.000Z');
    expect(slid.triggers?.map((t) => t.observedAt)).toEqual([
      '2026-11-02T00:00:00.000Z',
      '2026-10-07T00:00:00.000Z',
      '2026-11-18T00:00:00.000Z',
    ]);
    expect(slid.news?.[0]?.publishedAt).toBe('2026-11-09T00:00:00.000Z');
    expect(intel.refreshedAt).toBe('2026-05-10T08:00:00.000Z');
    expect(slid.hiring).toBe(intel.hiring);

    const later = projectFixtureIntel(intel, LATER, 'demo');
    expect(later.refreshedAt).toBe('2027-06-15T08:00:00.000Z');
    expect(later.triggers?.[2]?.observedAt).toBe('2027-06-06T00:00:00.000Z');
  });

  it('does not move a payload unless the mode is exactly demo and the stamp is still the seed', () => {
    const intel = seededIntel();
    for (const mode of ['real', 'Demo', 'DEMO', 'demo-x', ' demo', 'notdemo', ''] as const) {
      expect(projectFixtureIntel(intel, NOW, mode)).toBe(intel);
    }
    expect(projectFixtureIntel(intel, NOW, undefined)).toBe(intel);
    expect(projectFixtureIntel(intel, new Date('2026-05-10T00:00:00.000Z'), 'demo')).toBe(intel);
    expect(projectFixtureIntel(intel, new Date('2026-05-09T23:00:00.000Z'), 'demo')).toBe(intel);

    const edited = {
      ...intel,
      refreshedAt: '2026-05-11T08:00:00.000Z',
      triggers: intel.triggers.map((t, i) =>
        i === 2 ? { ...t, observedAt: '2026-05-02T00:00:00.000Z' } : t,
      ),
      news: [{ ...intel.news[0]!, publishedAt: '2026-04-23T00:00:00.000Z' }],
    };
    const slid = projectFixtureIntel(edited, NOW, 'demo');
    expect(slid.refreshedAt).toBe('2026-05-11T08:00:00.000Z');
    expect(slid.triggers?.[2]?.observedAt).toBe('2026-05-02T00:00:00.000Z');
    expect(slid.news?.[0]?.publishedAt).toBe('2026-04-23T00:00:00.000Z');
    expect(slid.triggers?.[0]?.observedAt).toBe('2026-11-02T00:00:00.000Z');
    expect(slid.triggers?.[1]?.observedAt).toBe('2026-10-07T00:00:00.000Z');
  });

  it('leaves a different id on its stored day', () => {
    const intel = seededIntel('OP-9999');
    intel.triggers[0] = { ...intel.triggers[0]!, id: 'custom-trigger' };
    const slid = projectFixtureIntel(intel, NOW, 'demo');
    expect(slid.triggers?.[0]?.observedAt).toBe('2026-04-15T00:00:00.000Z');
    expect(slid.news?.[0]?.id).toBe('OP-9999-n1');
    expect(slid.news?.[0]?.publishedAt).toBe('2026-11-09T00:00:00.000Z');
  });

  it('lists the same instants intelFor writes', () => {
    // WHY: the clock is a copy of the fixture payload. A new date in only
    // one of them leaves the deal page on the old day.
    const source = readFileSync(
      path.resolve(import.meta.dirname, '../../../../packages/db/src/seed-data.tasks-leads.ts'),
      'utf8',
    );
    const refreshed = source.match(/new Date\('([^']+)'\)\.toISOString\(\)/)?.[1];
    const observed = [...source.matchAll(/observedAt: '([^']+)'/g)].map((m) => m[1]);
    const published = [...source.matchAll(/publishedAt: '([^']+)'/g)].map((m) => m[1]);
    expect({ refreshed, observed, published }).toEqual(FIXTURE_INTEL_STAMPS);
  });

  it('slides the detail read the deal page renders', () => {
    // WHY: the cards print whatever useOpportunity returns. A clock that
    // nothing calls leaves the May dates on the ribbon.
    const source = readFileSync(path.resolve(import.meta.dirname, '../hooks/useOpportunities.ts'), 'utf8');
    expect(source).toContain('projectFixtureIntel');
    expect(source).toContain('usePoloPublicIdentity');
  });
});

import { describe, it, expect } from 'vitest';

import {
  STAGE_WIN_PROBABILITY,
  aggregateProjection,
  buildProjectionWindow,
  quarterLabel,
  quarterPeriodKey,
  quarterStart,
  resolveStageProbability,
  type ProjectionRow,
} from './forecasts-projection.helpers.js';

const NOW = new Date('2026-06-27T12:00:00Z'); // Q2 2026

describe('quarter math', () => {
  it('derives the quarter start (UTC) and period key', () => {
    expect(quarterStart(NOW).toISOString()).toBe('2026-04-01T00:00:00.000Z');
    expect(quarterPeriodKey(NOW)).toBe('2026-Q2');
    expect(quarterPeriodKey(new Date('2026-01-15T00:00:00Z'))).toBe('2026-Q1');
    expect(quarterPeriodKey(new Date('2026-12-31T00:00:00Z'))).toBe('2026-Q4');
  });

  it('labels a period key for humans', () => {
    expect(quarterLabel('2026-Q2')).toBe('Q2 2026');
  });
});

describe('buildProjectionWindow', () => {
  it('returns the current quarter plus the forward quarters with bounds', () => {
    const w = buildProjectionWindow(NOW, 2);
    expect(w.periods).toEqual(['2026-Q2', '2026-Q3', '2026-Q4']);
    expect(w.currentPeriod).toBe('2026-Q2');
    expect(w.curQuarterStart.toISOString()).toBe('2026-04-01T00:00:00.000Z');
    // Exclusive upper bound is the start of the quarter after the last period.
    expect(w.windowEndExclusive.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('rolls the window across a year boundary', () => {
    const w = buildProjectionWindow(new Date('2026-11-10T00:00:00Z'), 2);
    expect(w.periods).toEqual(['2026-Q4', '2027-Q1', '2027-Q2']);
    expect(w.windowEndExclusive.toISOString()).toBe('2027-07-01T00:00:00.000Z');
  });
});

describe('resolveStageProbability', () => {
  it('prefers the org config over the documented fallback', () => {
    const cfg = new Map<string, number>([['s2_sent', 55]]);
    expect(resolveStageProbability('s2_sent', cfg)).toBe(55);
  });

  it('falls back to the documented map when a stage is unconfigured', () => {
    expect(resolveStageProbability('s4_negotiation', new Map())).toBe(
      STAGE_WIN_PROBABILITY.s4_negotiation,
    );
  });
});

describe('aggregateProjection', () => {
  const window = buildProjectionWindow(NOW, 2);
  const probs = new Map<string, number>([
    ['s2_sent', 40],
    ['s4_negotiation', 80],
    ['closed_won', 100],
  ]);

  const row = (over: Partial<ProjectionRow>): ProjectionRow => ({
    period: '2026-Q2',
    ownerId: 'owner-1',
    ownerName: 'Jane',
    stage: 's2_sent',
    valueMicros: '1000000',
    ...over,
  });

  it('weights open pipeline by stage probability and keeps won separate', () => {
    const result = aggregateProjection(
      [
        row({ stage: 's2_sent', valueMicros: '1000000' }), // open, 40%
        row({ stage: 'closed_won', valueMicros: '500000' }), // won actual
      ],
      window,
      probs,
      new Map(),
    );
    const q2 = result.find((p) => p.period === '2026-Q2')!;
    expect(q2.openMicros).toBe(1_000_000); // won excluded from open
    expect(q2.weightedMicros).toBe(400_000); // 1,000,000 × 40%
    expect(q2.wonMicros).toBe(500_000);
  });

  it('returns every requested period even when empty, in order', () => {
    const result = aggregateProjection([], window, probs, new Map());
    expect(result.map((p) => p.period)).toEqual(['2026-Q2', '2026-Q3', '2026-Q4']);
    expect(result.every((p) => p.openMicros === 0 && p.byOwner.length === 0)).toBe(true);
  });

  it('skips rows outside the window (null period)', () => {
    const result = aggregateProjection([row({ period: null })], window, probs, new Map());
    expect(result.every((p) => p.openMicros === 0)).toBe(true);
  });

  it('sorts owners by weighted value desc and labels unassigned', () => {
    const result = aggregateProjection(
      [
        row({ ownerId: 'a', ownerName: 'Ann', stage: 's2_sent', valueMicros: '1000000' }), // w=400k
        row({ ownerId: null, ownerName: null, stage: 's4_negotiation', valueMicros: '1000000' }), // w=800k
      ],
      window,
      probs,
      new Map(),
    );
    const q2 = result.find((p) => p.period === '2026-Q2')!;
    expect(q2.byOwner[0]!.ownerName).toBe('Unassigned'); // 800k weighted first
    expect(q2.byOwner[0]!.ownerId).toBeNull();
    expect(q2.byOwner[1]!.ownerName).toBe('Ann');
  });

  it('overlays the manual commit override per period', () => {
    const result = aggregateProjection(
      [row({})],
      window,
      probs,
      new Map([['2026-Q3', 9_000_000]]),
    );
    expect(result.find((p) => p.period === '2026-Q2')!.manualCommitMicros).toBeNull();
    expect(result.find((p) => p.period === '2026-Q3')!.manualCommitMicros).toBe(9_000_000);
  });
});

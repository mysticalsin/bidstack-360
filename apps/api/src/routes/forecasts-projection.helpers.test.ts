import { readFileSync } from 'node:fs';

import { describe, it, expect } from 'vitest';

import {
  aggregateManualCommit,
  aggregateProjection,
  bidWeightedMicros,
  buildProjectionWindow,
  quarterLabel,
  quarterPeriodKey,
  quarterStart,
  type ManualCommitRow,
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

describe('bidWeightedMicros', () => {
  it('weights the IKEA bid at 75%, not the negotiation stage rate of 80%', () => {
    // Demo OP-0002 is s4_negotiation for 850,000 with probability 75 on the
    // bid. The stage default is 80. 80% would add 42,500 the rep did not enter.
    // The deal page and the workload report already use the bid's probability.
    const value = 850_000n * 1_000_000n;
    expect(bidWeightedMicros(value, 75)).toBe(637_500n * 1_000_000n);
    expect(bidWeightedMicros(value, 75)).not.toBe(680_000n * 1_000_000n);
  });

  it('rounds a half micros up, matching Postgres ROUND for a positive product', () => {
    // 1 micro × 50% = 0.5, which Postgres ROUND sends to 1. 49% stays 0.
    expect(bidWeightedMicros(1n, 50)).toBe(1n);
    expect(bidWeightedMicros(1n, 49)).toBe(0n);
    expect(bidWeightedMicros(0n, 75)).toBe(0n);
    expect(bidWeightedMicros(1_000_000n, 0)).toBe(0n);
  });

  it('keeps two negotiation bids on their own rates', () => {
    // One stage rate applied after the group sum would price both at 80.
    const low = bidWeightedMicros(100n * 1_000_000n, 50);
    const high = bidWeightedMicros(100n * 1_000_000n, 75);
    expect(low + high).toBe(125n * 1_000_000n);
    expect(low + high).not.toBe(160n * 1_000_000n);
  });
});

describe('aggregateProjection', () => {
  const window = buildProjectionWindow(NOW, 2);

  const row = (over: Partial<ProjectionRow>): ProjectionRow => ({
    period: '2026-Q2',
    ownerId: 'owner-1',
    ownerName: 'Jane',
    stage: 's2_sent',
    valueMicros: '1000000',
    weightedMicros: '0',
    ...over,
  });

  it('adds the bid-weighted sum and keeps won out of open and weighted', () => {
    const result = aggregateProjection(
      [
        row({ stage: 's2_sent', valueMicros: '1000000', weightedMicros: '400000' }),
        row({ stage: 'closed_won', valueMicros: '500000', weightedMicros: '500000' }),
      ],
      window,
      new Map(),
    );
    const q2 = result.find((p) => p.period === '2026-Q2')!;
    expect(q2.openMicros).toBe(1_000_000); // won excluded from open
    expect(q2.weightedMicros).toBe(400_000); // won weight is not a forecast
    expect(q2.wonMicros).toBe(500_000);
  });

  it('keeps the IKEA weight when a stage rate of 80% is not consulted', () => {
    // The grouped row already carries the per-bid weight. Replacing it with
    // 80% of 850,000 is the bug this projection used to ship.
    const weighted = bidWeightedMicros(850_000n * 1_000_000n, 75);
    const result = aggregateProjection(
      [
        row({
          stage: 's4_negotiation',
          valueMicros: String(850_000n * 1_000_000n),
          weightedMicros: weighted.toString(),
        }),
      ],
      window,
      new Map(),
    );
    const q2 = result.find((p) => p.period === '2026-Q2')!;
    expect(q2.openMicros).toBe(850_000 * 1_000_000);
    expect(q2.weightedMicros).toBe(Number(weighted));
  });

  it('adds two negotiation weights instead of one stage rate', () => {
    const low = bidWeightedMicros(100n * 1_000_000n, 50);
    const high = bidWeightedMicros(100n * 1_000_000n, 75);
    const result = aggregateProjection(
      [
        row({
          stage: 's4_negotiation',
          valueMicros: String(100n * 1_000_000n),
          weightedMicros: low.toString(),
        }),
        row({
          stage: 's4_negotiation',
          valueMicros: String(100n * 1_000_000n),
          weightedMicros: high.toString(),
        }),
      ],
      window,
      new Map(),
    );
    const q2 = result.find((p) => p.period === '2026-Q2')!;
    expect(q2.weightedMicros).toBe(Number(low + high));
    expect(q2.openMicros).toBe(200 * 1_000_000);
  });

  it('returns every requested period even when empty, in order', () => {
    const result = aggregateProjection([], window, new Map());
    expect(result.map((p) => p.period)).toEqual(['2026-Q2', '2026-Q3', '2026-Q4']);
    expect(result.every((p) => p.openMicros === 0 && p.byOwner.length === 0)).toBe(true);
  });

  it('skips rows outside the window (null period)', () => {
    const result = aggregateProjection([row({ period: null })], window, new Map());
    expect(result.every((p) => p.openMicros === 0)).toBe(true);
  });

  it('sorts owners by weighted value desc and labels unassigned', () => {
    const result = aggregateProjection(
      [
        row({
          ownerId: 'a',
          ownerName: 'Ann',
          stage: 's2_sent',
          valueMicros: '1000000',
          weightedMicros: '400000',
        }),
        row({
          ownerId: null,
          ownerName: null,
          stage: 's4_negotiation',
          valueMicros: '1000000',
          weightedMicros: '800000',
        }),
      ],
      window,
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
      new Map([['2026-Q3', 9_000_000]]),
    );
    expect(result.find((p) => p.period === '2026-Q2')!.manualCommitMicros).toBeNull();
    expect(result.find((p) => p.period === '2026-Q3')!.manualCommitMicros).toBe(9_000_000);
  });

  it('weights each bid in the projection query before the stage group is summed', () => {
    // The helper only adds the weight the query already computed. If the
    // query summed value first and applied the stage rate, the IKEA 75%
    // would never reach this function.
    const src = readFileSync(new URL('./forecasts-projection.ts', import.meta.url), 'utf8');
    expect(src).toContain('ROUND(o.value_micros * o.probability / 100.0)');
    expect(src).toContain("WHEN o.stage = 'closed_won' THEN 0");
    expect(src).toContain('aggregateProjection(rows, window, manualCommitByPeriod)');
    expect(src).not.toContain('loadStageProbabilities');
  });
});

describe('aggregateManualCommit', () => {
  const commitRow = (over: Partial<ManualCommitRow>): ManualCommitRow => ({
    period: '2026-Q2',
    amountMicros: 1_000_000,
    currency: 'EUR',
    ...over,
  });

  it('sums only rows matching the reporting currency', () => {
    // A commit row booked in USD must never be blended into a EUR total —
    // that would silently misstate the headline by whatever the FX delta is.
    const { byPeriod, excludedCount } = aggregateManualCommit(
      [commitRow({ amountMicros: 1_000_000, currency: 'EUR' }), commitRow({ amountMicros: 5_000_000, currency: 'USD' })],
      'EUR',
    );
    expect(byPeriod.get('2026-Q2')).toBe(1_000_000);
    expect(excludedCount).toBe(1);
  });

  it('reports zero exclusions when every row matches', () => {
    const { byPeriod, excludedCount } = aggregateManualCommit(
      [commitRow({ amountMicros: 2_000_000 }), commitRow({ amountMicros: 3_000_000 })],
      'EUR',
    );
    expect(byPeriod.get('2026-Q2')).toBe(5_000_000);
    expect(excludedCount).toBe(0);
  });

  it('handles bigint amountMicros from the Prisma driver', () => {
    const { byPeriod } = aggregateManualCommit(
      [commitRow({ amountMicros: BigInt(7_000_000) })],
      'EUR',
    );
    expect(byPeriod.get('2026-Q2')).toBe(7_000_000);
  });
});

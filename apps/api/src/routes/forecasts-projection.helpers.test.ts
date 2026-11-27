import { readFileSync } from 'node:fs';

import { describe, it, expect } from 'vitest';

import {
  aggregateManualCommit,
  aggregateProjection,
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

describe('aggregateProjection', () => {
  const window = buildProjectionWindow(NOW, 2);

  const row = (over: Partial<ProjectionRow>): ProjectionRow => ({
    period: '2026-Q2',
    ownerId: 'owner-1',
    ownerName: 'Jane',
    stage: 's2_sent',
    valueMicros: '1000000',
    weightedMicros: '400000',
    ...over,
  });

  it('adds the bid weight and keeps won out of open and weighted', () => {
    // WHY: the query already rounded each bid by the probability on the record.
    // Re-applying a stage rate here would put won into the weighted pipeline
    // and replace that per-bid figure.
    const result = aggregateProjection(
      [
        row({ stage: 's2_sent', valueMicros: '1000000', weightedMicros: '400000' }),
        row({ stage: 'closed_won', valueMicros: '500000', weightedMicros: '0' }),
      ],
      window,
      new Map(),
    );
    const q2 = result.find((p) => p.period === '2026-Q2')!;
    expect(q2.openMicros).toBe(1_000_000); // won excluded from open
    expect(q2.weightedMicros).toBe(400_000); // won weight is not a forecast
    expect(q2.wonMicros).toBe(500_000);
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
    const result = aggregateProjection([row({})], window, new Map([['2026-Q3', 9_000_000]]));
    expect(result.find((p) => p.period === '2026-Q2')!.manualCommitMicros).toBeNull();
    expect(result.find((p) => p.period === '2026-Q3')!.manualCommitMicros).toBe(9_000_000);
  });

  it('weights the IKEA bid at 75% on the record, not the 80% negotiation stage rate', () => {
    // WHY: demo OP-0002 (IKEA, Cloud Migration & FinOps) is negotiation at 75%
    // on the bid. The projection used to multiply by the stage rate of 80%.
    // That kept a stale weight of 680,000 on a 850,000 bid. The deal page
    // stores 75%. 80% adds 42,500 the rep did not enter. The grouped row
    // already carries the per-bid weight. This function must not replace it.
    const value = 850_000 * 1_000_000;
    const atBid = 637_500 * 1_000_000;
    const atStage = 680_000 * 1_000_000;
    const result = aggregateProjection(
      [
        row({
          stage: 's4_negotiation',
          valueMicros: String(value),
          weightedMicros: String(atBid),
        }),
      ],
      window,
      new Map(),
    );
    const q2 = result.find((p) => p.period === '2026-Q2')!;
    expect(q2.openMicros).toBe(value);
    expect(q2.weightedMicros).toBe(atBid);
    expect(q2.weightedMicros).not.toBe(atStage);
  });

  it('does not turn a failed value read into an empty quarter', () => {
    // WHY: a value the driver could not return as integer micros is not an
    // empty book. Number('nope') is NaN and Math.round(NaN) is NaN, which the
    // page can paint as a blank quarter. An empty window stays zero. A bad
    // read must fail instead of joining that zero.
    const empty = aggregateProjection([], window, new Map());
    expect(empty.every((p) => p.openMicros === 0 && p.weightedMicros === 0 && p.byOwner.length === 0)).toBe(
      true,
    );
    expect(() => aggregateProjection([row({ valueMicros: 'nope' })], window, new Map())).toThrow(
      /not an integer/,
    );
    // A fractional string is not integer micros. Rounding it would invent a weight.
    expect(() =>
      aggregateProjection([row({ valueMicros: '1.5', weightedMicros: '0' })], window, new Map()),
    ).toThrow(/not an integer/);
  });
});

describe('projection query weight', () => {
  it('weights each bid by the probability on the record before the stage group is summed', () => {
    // WHY: grouping by stage and then applying 80% never sees the 75% stored
    // on OP-0002. The weight has to be computed per bid. A failed numeric
    // read must not be coerced into a zero weight.
    const src = readFileSync(new URL('./forecasts-projection.ts', import.meta.url), 'utf8');
    expect(src).toContain('ROUND(o.value_micros * o.probability / 100.0)');
    expect(src).toContain("WHEN o.stage = 'closed_won' THEN 0");
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

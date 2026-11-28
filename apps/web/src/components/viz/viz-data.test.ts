import { describe, expect, it } from 'vitest';

import {
  accountBars, cumulativeOpen, cumulativeWon, fmtCompact, pastCloseOpenValue, pastDueOpen, quarterOf, runningWinRate, stageFunnel, stageKey,
  stageText, statusMix, winRateByQuarter, wonByQuarter, type OppRow,
} from './viz-data';

const row = (o: Partial<OppRow>): OppRow => ({ id: Math.random().toString(36), stage: 's1_lead', value: 100, dueDate: null, customer: 'A', ...o });

const rows: OppRow[] = [
  row({ stage: 'S1 Lead', value: 10 }),
  row({ stage: 's4_negotiation', value: 400, dueDate: '2026-06-30T00:00:00.000Z', customer: 'B' }),
  row({ stage: 'closed_won', value: 200, dueDate: '2026-02-03T00:00:00.000Z' }),
  row({ stage: 'closed_won', value: 300, dueDate: '2026-04-04T00:00:00.000Z', customer: 'B' }),
  row({ stage: 'closed_lost', value: 50, dueDate: '2026-10-01T00:00:00.000Z' }),
];

describe('viz-data', () => {
  it('normalises stage names and sentence-cases labels', () => {
    expect(stageKey('S1 Lead')).toBe('s1_lead');
    expect(stageText('s3_technical_iteration')).toBe('S3 technical iteration');
  });

  it('buckets calendar dates on UTC so 1 Oct stays in Q4', () => {
    expect(quarterOf('2026-10-01T00:00:00.000Z')).toBe('Q4 2026');
  });

  it('derives funnel, status mix and win rate from rows only', () => {
    expect(stageFunnel(rows).map((s) => [s.label, s.value])).toEqual([['S1 lead', 10], ['S4 negotiation', 400]]);
    expect(statusMix(rows)).toEqual({ open: 2, won: 2, lost: 1 });
    const wr = winRateByQuarter(rows);
    // Each quarter carries its start date for the time axis.
    expect(wr.map((q) => [q.date.getFullYear(), q.date.getMonth()])).toEqual([[2026, 0], [2026, 3], [2026, 9]]);
    expect(wr.map(({ date: _d, ...q }) => q)).toEqual([
      { x: 'Q1 2026', won: 1, lost: 0, rate: 100 },
      { x: 'Q2 2026', won: 1, lost: 0, rate: 100 },
      { x: 'Q4 2026', won: 0, lost: 1, rate: 0 },
    ]);
    expect(wonByQuarter(rows)).toEqual([{ label: 'Q1 2026', won: 200 }, { label: 'Q2 2026', won: 300 }]);
  });

  it('accumulates won value by month and open value by due date', () => {
    const won = cumulativeWon(rows);
    expect(won.map((p) => [p.x, p.y])).toEqual([['Jan', 0], ['Feb', 200], ['Mar', 200], ['Apr', 500]]);
    expect(cumulativeOpen(rows)).toEqual([0, 10, 410]);
    expect(runningWinRate(rows)).toEqual([100, 100, 67]);
  });

  it('ranks accounts by won + open and ignores lost value', () => {
    expect(accountBars(rows)).toEqual([{ label: 'B', open: 400, won: 300 }, { label: 'A', open: 10, won: 200 }]);
  });

  it('flags open bids past their due date', () => {
    expect(pastDueOpen(rows, Date.parse('2026-10-31')).map((o) => o.customer)).toEqual(['B']);
  });

  it('sums open bids that closed before this quarter and leaves won, undated, and in-quarter bids out', () => {
    // WHY: the demo book closes between April and September 2026. On 25 Nov 2026
    // the forecast rolls every one of those open bids into Q4. A won April bid,
    // a bid with no close date, and a bid due inside Q4 are not that slipped book.
    const now = Date.parse('2026-11-25T15:00:00.000Z');
    const demo = [
      row({ id: '2041', stage: 's3_technical_iteration', value: 1_240_000, dueDate: '2026-07-22' }),
      row({ id: '2043', stage: 's4_negotiation', value: 4_800_000, dueDate: '2026-06-30' }),
      row({ id: '2046', stage: 'closed_won', value: 410_000, dueDate: '2026-04-28' }),
      row({ id: 'blank', stage: 's1_ongoing', value: 900_000, dueDate: null }),
      row({ id: 'in-quarter', stage: 's2_sent', value: 100_000, dueDate: '2026-10-01' }),
    ];
    expect(pastCloseOpenValue(demo, now)).toEqual({ quarter: 'Q4 2026', value: 6_040_000 });
  });

  it('keeps two compact digits when they name the same amount', () => {
    // WHY: 7,860,000 was 7.9m, and an exact 11,890,000 stays 11.89m rather than 11.9m.
    // A non-exact amount uses one digit, so it does not spill the full figure.
    expect(fmtCompact(7_860_000)).toBe('7.86m');
    expect(fmtCompact(7_860_000)).not.toMatch(/7\.9/);
    expect(fmtCompact(11_890_000)).toBe('11.89m');
    expect(fmtCompact(12_015_000)).toBe('12m');
    expect(fmtCompact(1_500_000)).toBe('1.5m');
  });

  it('compacts a fractional amount instead of printing the full figure', () => {
    // WHY: 11,595,650.688 was printed as 11,595,650.688 and wrapped the dashboard hero.
    // A fraction must use the same compact label as an integer of that size.
    // Main's one-digit compact is 11.6m for that figure and 7.1m for 7,060,500.
    expect(fmtCompact(11_595_650.688)).toBe('11.6m');
    expect(fmtCompact(7_060_500)).toBe('7.1m');
    expect(fmtCompact(999.4)).toBe('999.4');
    expect(fmtCompact(0.5)).toBe('0.5');
    expect(fmtCompact(1_000.4)).toBe('1k');
    expect(fmtCompact(-11_595_650.688)).toBe('-11.6m');
    expect(fmtCompact(-999.4)).toBe('-999.4');
    expect(fmtCompact(-0.5)).toBe('-0.5');
    expect(fmtCompact(Number.NaN)).toBe('NaN');
    expect(fmtCompact(Number.POSITIVE_INFINITY)).toBe('∞');
    expect(fmtCompact(Number.NEGATIVE_INFINITY)).toBe('-∞');
    // Half a unit is what a micros remainder looks like once it is no longer a whole unit.
    expect(fmtCompact(1_500_000.5)).toBe('1.5m');
  });
});

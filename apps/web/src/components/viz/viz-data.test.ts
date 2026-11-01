import { describe, expect, it } from 'vitest';

import {
  accountBars, cumulativeOpen, cumulativeWon, fmtCompact, forecastPoint, pastDueOpen, quarterOf, runningWinRate, stageBuckets, stageFunnel, stageKey,
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
    expect(wonByQuarter(rows)).toEqual([
      { label: 'Q1 2026', won: 200, wonMicros: '200000000' },
      { label: 'Q2 2026', won: 300, wonMicros: '300000000' },
    ]);
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

  it('keeps a live lost stage out of the open charts', () => {
    // WHY: the list sends the stage name, not closed_lost, so the enum check left the deal open.
    const lost = row({
      stage: 'Price lost',
      value: 80,
      dueDate: '2026-01-01',
      customer: 'C',
      pipelineStage: { isWon: false, isLost: true, deletedAt: null },
    });
    const open = row({ stage: 's2_sent', value: 20, dueDate: '2026-01-02', customer: 'C' });
    const flaggedOpenKey = row({
      stage: 's4_negotiation',
      value: 5,
      pipelineStage: { isLost: true },
    });
    expect(statusMix([lost, open])).toEqual({ open: 1, won: 0, lost: 1 });
    expect(cumulativeOpen([lost, open])).toEqual([0, 20]);
    expect(accountBars([lost, open])).toEqual([{ label: 'C', open: 20, won: 0 }]);
    expect(stageFunnel([flaggedOpenKey])).toEqual([]);
    const named = row({ stage: 'Proposal review', value: 30, customer: 'C' });
    const funnel = stageFunnel([...rows, named]);
    expect(funnel.map((stage) => stage.label)).toEqual(['S1 lead', 'S4 negotiation', 'Proposal review']);
    expect(funnel.find((stage) => stage.id === 'Proposal review')).toMatchObject({ value: 30, count: 1 });
    expect(stageBuckets([named, row({ stage: 'closed_won', value: 9 })]).map((stage) => stage.id)).toEqual([
      'Proposal review',
      'closed_won',
    ]);
    expect(pastDueOpen([lost], Date.parse('2026-06-01'))).toEqual([]);
    const fromMicros = stageFunnel([
      row({ stage: 's2_sent', value: 0, valueMicros: '7860000000000' }),
      row({ stage: 's2_sent', value: 0, valueMicros: '12015000000000' }),
    ]);
    expect(fromMicros[0]).toMatchObject({ value: 19_875_000, count: 2, amount: '19,875,000' });
    const storedWon = row({
      stage: 'closed_won',
      value: 0,
      valueMicros: '200000000',
      dueDate: '2026-02-03T00:00:00.000Z',
      closedAt: '2026-02-03T00:00:00.000Z',
    });
    const storedOpen = row({ stage: 's2_sent', value: 0, valueMicros: '10000000', dueDate: '2026-05-01' });
    // WHY: the quarter bar and the spark added the unit number, so a stored amount of 0 units drew nothing.
    expect(wonByQuarter([storedWon])).toEqual([{ label: 'Q1 2026', won: 200, wonMicros: '200000000' }]);
    expect(cumulativeWon([storedWon]).map((point) => point.y)).toEqual([0, 200]);
    expect(cumulativeOpen([storedOpen])).toEqual([0, 10]);
    expect(fmtCompact(7_860_000)).toContain('7.86');
    expect(fmtCompact(7_860_000)).not.toMatch(/7\.9/);
    expect(fmtCompact(12_015_000)).toBe('12,015,000');
    const forecast = forecastPoint({
      label: 'Q1 2026',
      wonMicros: '7860000000000',
      weightedMicros: '12015000000000',
      openMicros: '0',
    });
    expect(forecast.won).toBe(7_860_000);
    expect(forecast.wonLabel).toContain('7.86');
    expect(forecast.wonLabel).not.toMatch(/7\.9/);
    expect(forecast.weightedLabel).toBe('12,015,000');
    const unread = forecastPoint({
      label: 'Q2 2026',
      wonMicros: Number.MAX_SAFE_INTEGER + 2,
      weightedMicros: '0',
      openMicros: '0',
    });
    expect(unread.wonLabel).toBe('amount not readable');
    expect(unread.won).toBe(0);
    expect(statusMix([row({
      stage: 's2_sent',
      pipelineStage: { isLost: true, deletedAt: '2026-02-01T00:00:00.000Z' },
    })]).open).toBe(1);
  });
});

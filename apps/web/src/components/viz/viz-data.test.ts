import { describe, expect, it } from 'vitest';

import {
  accountBars, cumulativeOpen, cumulativeWon, oppStatus, pastDueOpen, quarterOf, runningWinRate, stageFunnel, stageKey,
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

  it('keeps a live lost stage out of the open book', () => {
    // WHY: the chart read the stage name only. A live lost flag on an open
    // key stayed in the open sum, and both flags still counted as a win.
    // Deleting the stage row must not drop a closed_lost key.
    const lostFlag = row({
      stage: 'S4 Negotiation',
      value: 80,
      customer: 'A',
      dueDate: '2026-05-01T00:00:00.000Z',
      pipelineStage: { isWon: false, isLost: true },
    });
    const both = row({
      stage: 'closed_won',
      value: 90,
      customer: 'B',
      dueDate: '2026-03-01T00:00:00.000Z',
      pipelineStage: { isWon: true, isLost: true },
    });
    const deletedLost = row({
      stage: 'closed_lost',
      value: 70,
      customer: 'A',
      pipelineStage: { isWon: true, isLost: false, deletedAt: '2026-02-01T00:00:00.000Z' },
    });
    const book = [...rows, lostFlag, both, deletedLost];

    const wonFlag = row({
      stage: 'S2 Sent',
      value: 15,
      pipelineStage: { isWon: true, isLost: false },
    });

    expect(oppStatus(lostFlag)).toBe('lost');
    expect(oppStatus(both)).toBe('lost');
    expect(oppStatus(deletedLost)).toBe('lost');
    expect(oppStatus(wonFlag)).toBe('won');
    expect(statusMix(book)).toEqual({ open: 2, won: 2, lost: 4 });
    expect(stageFunnel(book).map((s) => [s.label, s.value])).toEqual([
      ['S1 lead', 10],
      ['S4 negotiation', 400],
    ]);
    expect(accountBars(book)).toEqual([
      { label: 'B', open: 400, won: 300 },
      { label: 'A', open: 10, won: 200 },
    ]);
    expect(cumulativeOpen(book)).toEqual([0, 10, 410]);
    expect(pastDueOpen([lostFlag], Date.parse('2026-10-31'))).toEqual([]);
    expect(runningWinRate([both])).toEqual([0]);
  });
});

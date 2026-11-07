import { describe, expect, it } from 'vitest';

import type { OppRow } from '@/components/viz/viz-data';

import {
  activityByHour,
  bidCriteriaRadar,
  forecastPeriodBars,
  pipelineByCloseMonth,
  SALES_CYCLE_OVERDUE_DAYS,
  sectorPipeline,
  winFactorRows,
  winLossQuarterBars,
} from './bid-chart-data';

const NOW = Date.UTC(2026, 10, 7, 12); // 7 Nov 2026

const rows: OppRow[] = [
  { id: 'w1', stage: 'closed_won', value: 500, dueDate: '2026-03-10', closedAt: '2026-03-12', customer: 'A' },
  { id: 'w2', stage: 'closed_won', value: 300, dueDate: '2026-03-01', customer: 'B' },
  { id: 'l1', stage: 'closed_lost', value: 200, dueDate: '2026-05-20', customer: 'C' },
  { id: 'o1', stage: 's2_sent', value: 1000, dueDate: '2026-09-15', customer: 'D' },
  { id: 'o2', stage: 's4_negotiation', value: 400, dueDate: '2026-12-01', customer: 'E' },
  { id: 'far', stage: 's1_lead', value: 9000, dueDate: '2029-01-01', customer: 'F' },
  { id: 'nodate', stage: 's1_lead', value: 50, dueDate: null, customer: 'G' },
];

describe('pipelineByCloseMonth', () => {
  it('stacks won, lost and open by close month and hangs overdue below', () => {
    const out = pipelineByCloseMonth(rows, NOW);
    expect(out.keys[0]).toBe('2026-03');
    expect(out.keys.at(-1)).toBe('2026-12');
    expect(out.keys).toHaveLength(10);
    const at = (k: string) => out.keys.indexOf(k);
    expect(out.won[at('2026-03')]).toBe(800);
    expect(out.lost[at('2026-05')]).toBe(200);
    expect(out.open[at('2026-09')]).toBe(1000);
    expect(out.overdue[at('2026-09')]).toBe(1000);
    expect(out.open[at('2026-12')]).toBe(400);
    expect(out.overdue[at('2026-12')]).toBe(0);
  });

  it('labels January and the first column with the year', () => {
    const out = pipelineByCloseMonth(rows, NOW);
    expect(out.labels[0]).toBe('Mar 2026');
    expect(out.labels[1]).toBe('Apr');
  });

  it('drops rows outside the window and rows without a date', () => {
    const out = pipelineByCloseMonth(rows, NOW);
    const sum = (a: number[]) => a.reduce((n, v) => n + v, 0);
    expect(sum(out.open)).toBe(1400);
  });

  it('returns empty series for no rows', () => {
    expect(pipelineByCloseMonth([], NOW)).toEqual({ keys: [], labels: [], won: [], lost: [], open: [], overdue: [] });
  });

  it('is deterministic across calls', () => {
    expect(pipelineByCloseMonth(rows, NOW)).toEqual(pipelineByCloseMonth(rows, NOW));
  });
});

describe('activityByHour', () => {
  const items = [
    { occurredAt: '2026-11-02T09:15:00Z', type: 'call' },
    { occurredAt: '2026-11-02T09:45:00Z', type: 'email' },
    { occurredAt: '2026-11-03T09:05:00Z', type: 'email_opened' },
    { occurredAt: '2026-11-03T14:00:00Z', type: 'meeting' },
    { occurredAt: '2026-11-04T23:30:00Z', type: 'stage_change' },
  ];

  it('buckets by hour of day in the given zone, grouped by kind', () => {
    const out = activityByHour(items, 'UTC');
    expect(out.labels).toHaveLength(24);
    expect(out.labels[9]).toBe('09');
    expect(out.total).toBe(5);
    const byId = Object.fromEntries(out.series.map((s) => [s.id, s.values]));
    expect(byId.call![9]).toBe(1);
    expect(byId.email![9]).toBe(2);
    expect(byId.meeting![14]).toBe(1);
    expect(byId.other![23]).toBe(1);
  });

  it('shifts hours with the time zone', () => {
    const out = activityByHour(items, 'America/Toronto');
    const byId = Object.fromEntries(out.series.map((s) => [s.id, s.values]));
    expect(byId.call![4]).toBe(1);
  });

  it('leaves out kinds with no activity and reports zero for an empty feed', () => {
    expect(activityByHour(items.slice(0, 1), 'UTC').series.map((s) => s.id)).toEqual(['call']);
    expect(activityByHour([], 'UTC')).toEqual({ labels: expect.any(Array), series: [], total: 0 });
  });
});

describe('winFactorRows', () => {
  it('orders drivers from strongest positive to strongest negative', () => {
    const out = winFactorRows([
      { label: 'Incumbent risk', contribution: -12 },
      { label: 'Champion strength', contribution: 18 },
      { label: 'Long deal cycle', contribution: -8 },
      { label: 'Pricing competitiveness', contribution: 15 },
    ]);
    expect(out.map((r) => r.value)).toEqual([18, 15, -8, -12]);
    expect(out[0]!.label).toBe('Champion strength');
  });
});

describe('bidCriteriaRadar', () => {
  it('maps every registry criterion to an axis with the go threshold as baseline', () => {
    const out = bidCriteriaRadar({ strategic_fit: 4, deal_size: 5, timeline_risk: 2 });
    expect(out.axes).toHaveLength(10);
    expect(out.axes[0]).toBe('Strategic Fit');
    expect(out.values[0]).toBe(4);
    expect(out.baseline.every((v) => v === 3.75)).toBe(true);
    expect(out.rated).toBe(3);
  });

  it('reports nothing rated for an empty score', () => {
    expect(bidCriteriaRadar({}).rated).toBe(0);
  });
});

describe('winLossQuarterBars', () => {
  it('relabels API quarters and keeps won above, lost below', () => {
    const out = winLossQuarterBars([
      { quarter: '2026-Q1', won: 1, lost: 3 },
      { quarter: '2026-Q2', won: 2, lost: 0 },
    ]);
    expect(out).toEqual({ labels: ['Q1 2026', 'Q2 2026'], won: [1, 2], lost: [3, 0] });
  });
});

describe('sales cycle threshold', () => {
  it('is a whole number of days', () => {
    expect(Number.isInteger(SALES_CYCLE_OVERDUE_DAYS)).toBe(true);
  });
});

describe('sectorPipeline', () => {
  const sectorRows = [
    { ...rows[3]!, industry: 'financial_services' },
    { ...rows[4]!, industry: 'financial_services' },
    { id: 'h', stage: 's1_lead', value: 700, dueDate: '2026-10-01', customer: 'H', industry: 'healthcare' },
    { id: 'x', stage: 's1_lead', value: 100, dueDate: '2026-12-20', customer: 'X', industry: null },
    { ...rows[0]!, industry: 'healthcare' },
  ];

  it('sums open value per sector with overdue value in front, biggest first', () => {
    const out = sectorPipeline(sectorRows, NOW);
    expect(out.labels).toEqual(['Financial services', 'Healthcare', 'Unclassified']);
    expect(out.open).toEqual([1400, 700, 100]);
    expect(out.overdue).toEqual([1000, 700, 0]);
  });

  it('caps the number of sectors', () => {
    expect(sectorPipeline(sectorRows, NOW, 2).labels).toHaveLength(2);
  });
});

describe('forecastPeriodBars', () => {
  it('splits open pipeline into weighted and unweighted, in whole units', () => {
    const out = forecastPeriodBars([
      { label: 'Q4 2026', openMicros: 73_000_000, weightedMicros: 39_100_000, wonMicros: 0 },
      { label: 'Q1 2027', openMicros: 0, weightedMicros: 0, wonMicros: 0 },
      { label: 'Q2 2027', openMicros: 10_000_000, weightedMicros: 4_000_000, wonMicros: 2_000_000 },
    ]);
    expect(out.labels).toEqual(['Q4 2026', 'Q2 2027']);
    expect(out.weighted).toEqual([39.1, 4]);
    expect(out.unweighted).toEqual([33.9, 6]);
    expect(out.won).toEqual([0, 2]);
  });
});

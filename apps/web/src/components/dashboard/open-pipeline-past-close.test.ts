import { describe, expect, it } from 'vitest';

import type { OppRow } from '@/components/viz/viz-data';

import { openPipelinePastClose } from './open-pipeline-past-close';

// 25 Nov 2026, after the Polo open book. Those six bids are dated
// 30 Jun through 30 Sep 2026 and are still open. A due day of today is not late.
const NOW = Date.parse('2026-11-25T15:00:00.000Z');

const poloOpen: OppRow[] = [
  { id: 'OP-2041', stage: 's3_technical_iteration', value: 1_240_000, dueDate: '2026-07-22', customer: 'CI Financial' },
  { id: 'OP-2042', stage: 's1_ongoing', value: 320_000, dueDate: '2026-08-15', customer: 'Logistec Corporation' },
  { id: 'OP-2043', stage: 's4_negotiation', value: 4_800_000, dueDate: '2026-06-30', customer: 'Rush University System for Health' },
  { id: 'OP-2044', stage: 's1_ongoing', value: 680_000, dueDate: '2026-09-30', customer: 'MAPFRE' },
  { id: 'OP-2045', stage: 's2_sent', value: 2_150_000, dueDate: '2026-08-01', customer: 'MAHLE' },
  { id: 'OP-2048', stage: 's1_ongoing', value: 2_700_000, dueDate: '2026-09-15', customer: 'DNB Bank' },
];

describe('openPipelinePastClose', () => {
  it('sums the whole Polo open book on 25 Nov 2026, because every close day has passed', () => {
    // WHY: the home figure prints 11.89m with no split. These six rows are that 11.89m.
    expect(openPipelinePastClose(poloOpen, NOW)).toEqual({ count: 6, value: 11_890_000 });
  });

  it('keeps a bid due today in the open figure', () => {
    // WHY: the due day is still today. Counting it as past close would disagree with the deal board.
    const rows: OppRow[] = [
      { id: 'today', stage: 's2_sent', value: 50_000, dueDate: '2026-11-25', customer: 'Today Co' },
      { id: 'yesterday', stage: 'S2 Sent', value: 80_000, dueDate: '2026-11-24', customer: 'Yesterday Co' },
    ];
    expect(openPipelinePastClose(rows, NOW)).toEqual({ count: 1, value: 80_000 });
  });

  it('leaves won, lost, and undated bids out of the past-close sum', () => {
    // WHY: a decided bid is an outcome. A missing date is unscheduled, not late.
    const rows: OppRow[] = [
      { id: 'won', stage: 'Closed Won', value: 410_000, dueDate: '2026-04-28', customer: 'Aritzia' },
      { id: 'lost', stage: 'closed_lost', value: 1_900_000, dueDate: '2026-04-12', customer: 'NOS' },
      { id: 'undated', stage: 's1_ongoing', value: 900_000, dueDate: null, customer: 'No Date' },
      { id: 'future', stage: 's4_negotiation', value: 100_000, dueDate: '2026-12-01', customer: 'Later' },
    ];
    expect(openPipelinePastClose(rows, NOW)).toEqual({ count: 0, value: 0 });
  });
});

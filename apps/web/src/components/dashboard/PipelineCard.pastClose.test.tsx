import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OppRow } from '@/components/viz/viz-data';

import { PipelineCard } from './DashboardVisuals';

// The Polo open book on 25 Nov 2026, plus Aritzia won and NOS lost.
// The card was saying "6 open of 8 bids" with no past-close count.
const NOW = Date.parse('2026-11-25T15:00:00.000Z');

const poloBook: OppRow[] = [
  { id: 'OP-2041', stage: 's3_technical_iteration', value: 1_240_000, dueDate: '2026-07-22', customer: 'CI Financial' },
  { id: 'OP-2042', stage: 's1_ongoing', value: 320_000, dueDate: '2026-08-15', customer: 'Logistec Corporation' },
  { id: 'OP-2043', stage: 's4_negotiation', value: 4_800_000, dueDate: '2026-06-30', customer: 'Rush University System for Health' },
  { id: 'OP-2044', stage: 's1_ongoing', value: 680_000, dueDate: '2026-09-30', customer: 'MAPFRE' },
  { id: 'OP-2045', stage: 's2_sent', value: 2_150_000, dueDate: '2026-08-01', customer: 'MAHLE' },
  { id: 'OP-2046', stage: 'closed_won', value: 410_000, dueDate: '2026-04-28', customer: 'Aritzia' },
  { id: 'OP-2047', stage: 'closed_lost', value: 1_900_000, dueDate: '2026-04-12', customer: 'NOS' },
  { id: 'OP-2048', stage: 's1_ongoing', value: 2_700_000, dueDate: '2026-09-15', customer: 'DNB Bank' },
];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('PipelineCard open count past close', () => {
  it('names the Polo open count as past close instead of a current book of 6', () => {
    render(<PipelineCard rows={poloBook} onDrill={vi.fn()} />);

    const card = screen.getByTestId('dashboard-pipeline');
    expect(card.textContent).toMatch(/6 open of 8 bids, 6 past close/);
    expect(card.textContent).toMatch(/All 6 open bids are past close/);
    expect(card.textContent).not.toMatch(/sit today/);
  });

  it('keeps a book that is still inside its close days free of a past-close count', () => {
    const rows: OppRow[] = [
      { id: 'later', stage: 's2_sent', value: 100_000, dueDate: '2026-12-01', customer: 'Later' },
      { id: 'won', stage: 'closed_won', value: 40_000, dueDate: '2026-04-01', customer: 'Won Co' },
    ];
    render(<PipelineCard rows={rows} onDrill={vi.fn()} />);

    const card = screen.getByTestId('dashboard-pipeline');
    expect(card.textContent).toMatch(/1 open of 2 bids/);
    expect(card.textContent).not.toMatch(/past close/);
    expect(card.textContent).toMatch(/sit today/);
  });
});

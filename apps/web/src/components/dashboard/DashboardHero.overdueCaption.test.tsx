// The home chart always said overdue bids hang below the line. The demo
// sign-in book dates every bid 45 days out, so on 25 Nov 2026 that series is
// empty. A zero series still drew an Overdue control and the same sentence.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { OppRow } from '@/components/viz/viz-data';

import { DashboardHero } from './DashboardVisuals';

const DEMO_DUE = '2027-01-09';

/** Demo sign-in book: open bids and one won bid, all dated 45 days out. */
const demoBook: OppRow[] = [
  { id: 's1', stage: 's3_technical_iteration', value: 1_200_000, dueDate: DEMO_DUE, customer: 'Siemens' },
  { id: 's2', stage: 's4_negotiation', value: 850_000, dueDate: DEMO_DUE, customer: 'IKEA' },
  { id: 's3', stage: 's2_sent', value: 2_400_000, dueDate: DEMO_DUE, customer: 'Sanofi' },
  { id: 's4', stage: 's1_ongoing', value: 1_750_000, dueDate: DEMO_DUE, customer: 'HSBC' },
  { id: 'won', stage: 'closed_won', value: 620_000, dueDate: DEMO_DUE, customer: 'Stellantis' },
];

function renderHero(rows: OppRow[], openCount = rows.length) {
  render(
    <DashboardHero
      rows={rows}
      openValue={rows.reduce((n, row) => n + (row.value ?? 0), 0)}
      weighted={0}
      openCount={openCount}
    />,
  );
}

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('home chart overdue caption', () => {
  it('does not draw an empty overdue series for the demo book', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-25T12:00:00Z'));
    renderHero(demoBook, 4);

    // The open bids are still inside their close day. An Overdue control would
    // say the book is late when every due day is 9 Jan 2027.
    expect(screen.queryByRole('button', { name: 'Overdue' })).toBeNull();
    expect(screen.queryByText(/Overdue bids hang below the line/)).toBeNull();
    expect(screen.getByText('Select a month or a number to see the bids.')).toBeTruthy();
  });

  it('keeps the overdue sentence when an open bid is already past its close day', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-25T12:00:00Z'));
    renderHero([
      { id: 'late', stage: 's4_negotiation', value: 4_800_000, dueDate: '2026-06-30', customer: 'Rush' },
    ]);

    expect(screen.getByRole('button', { name: 'Overdue' })).toBeTruthy();
    expect(screen.getByText(/Overdue bids hang below the line/)).toBeTruthy();
  });

  it('does not talk about overdue bids when the chart has no dates', () => {
    renderHero([]);
    expect(screen.getByText('No dated bids yet.')).toBeTruthy();
    expect(screen.queryByText(/Overdue bids hang below the line/)).toBeNull();
  });
});

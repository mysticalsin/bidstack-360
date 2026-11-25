import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { filterOpps } from '@/components/drill/filterOpps';
import type { OppRow } from '@/components/viz/viz-data';

import { DashboardHero, NeedsYou } from './DashboardVisuals';

const rows: OppRow[] = [
  { id: 'w1', stage: 'closed_won', value: 7_900_000, dueDate: '2026-10-02', closedAt: '2026-10-02', customer: 'Rush' },
  { id: 'l1', stage: 'closed_lost', value: 1_900_000, dueDate: '2026-09-12', customer: 'NOS' },
  { id: 'o1', stage: 's1_ongoing', value: 2_700_000, dueDate: '2026-09-15', customer: 'DNB Bank' },
  { id: 'o2', stage: 's2_sent', value: 2_150_000, dueDate: '2026-12-01', customer: 'MAHLE' },
];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-07T12:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('DashboardHero', () => {
  it('keeps the headline figures and draws bids by close month as diverging bars', () => {
    render(<DashboardHero rows={rows} openValue={11_900_000} weighted={7_100_000} openCount={6} onDrill={vi.fn()} />);
    expect(screen.getByRole('button', { name: /open pipeline 11\.9M: show the open bids/i })).toBeTruthy();
    expect(screen.getByText(/^Weighted 7\.1M$/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /won this year 7\.9M/i })).toBeTruthy();
    expect(screen.getByRole('group', { name: /bids by close month/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Overdue' })).toBeTruthy();
  });

  it('opens the bids behind a month on Enter, not on arrow keys', () => {
    const onDrill = vi.fn();
    render(<DashboardHero rows={rows} openValue={11_900_000} weighted={7_100_000} openCount={6} onDrill={onDrill} />);
    const group = screen.getByRole('group', { name: /bids by close month/i });
    fireEvent.keyDown(group, { key: 'ArrowRight' });
    expect(onDrill).not.toHaveBeenCalled();
    fireEvent.keyDown(group, { key: 'Enter' });
    expect(onDrill).toHaveBeenCalledWith({ status: 'all', closeMonth: '2026-09' });
  });

  it('offers the numbers as a table', () => {
    render(<DashboardHero rows={rows} openValue={11_900_000} weighted={7_100_000} openCount={6} />);
    fireEvent.click(screen.getByRole('button', { name: 'Table' }));
    expect(screen.getByRole('columnheader', { name: 'Overdue' })).toBeTruthy();
    expect(screen.getByRole('rowheader', { name: 'Sep 2026' })).toBeTruthy();
  });

  it('shows an empty state without dated bids', () => {
    render(<DashboardHero rows={[]} openValue={0} weighted={0} openCount={0} />);
    expect(screen.getByText('No dated bids yet.')).toBeTruthy();
  });
});

describe('NeedsYou past due', () => {
  it('does not call a bid due today past due', () => {
    // WHY: the clock is noon UTC on the due day. Elapsed milliseconds already
    // say the date has passed. The row must stay quiet so it matches "Due today".
    const today: OppRow = {
      id: 't',
      stage: 's2_sent',
      value: 100,
      dueDate: '2026-11-07',
      customer: 'MAHLE',
    };
    render(
      <MemoryRouter>
        <NeedsYou rows={[today]} overdueTasks={0} />
      </MemoryRouter>,
    );
    expect(screen.queryByText(/past due/i)).toBeNull();
    expect(screen.getByText('Nothing waiting. Nice.')).toBeTruthy();
  });

  it('still names an open bid whose due day was yesterday', () => {
    const yesterday: OppRow = {
      id: 'y',
      stage: 's2_sent',
      value: 100,
      dueDate: '2026-11-06',
      customer: 'DNB Bank',
    };
    render(
      <MemoryRouter>
        <NeedsYou rows={[yesterday]} overdueTasks={0} />
      </MemoryRouter>,
    );
    expect(screen.getByText('1 open bid past due date')).toBeTruthy();
  });
});

describe('filterOpps closeMonth', () => {
  it('keeps bids whose close date falls in that month', () => {
    expect(filterOpps(rows, { status: 'all', closeMonth: '2026-09' }).map((o) => o.id)).toEqual(['l1', 'o1']);
  });
});

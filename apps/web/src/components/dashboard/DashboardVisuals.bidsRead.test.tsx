// A bid read that has not settled is not an empty book. The workspace
// dashboard may say there are no bids only after that read succeeds with none.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import type { OppRow } from '@/components/viz/viz-data';

import { DashboardHero, NeedsYou, PerformanceCard, PipelineCard } from './DashboardVisuals';

const RETRY_CLASS = ['min-h-11', 'focus-visible:ring-2', 'text-[var(--fg-primary)]'];

function bid(): OppRow {
  return {
    id: 'labs',
    customer: 'Globex Labs',
    stage: 's1_ongoing',
    value: 2_500_000,
    dueDate: '2026-09-01',
  };
}

afterEach(() => {
  cleanup();
});

describe('workspace dashboard before the bid read settles', () => {
  it('does not call a failed bid read an empty pipeline', () => {
    // WHY: "No open bids" on a failed read sends someone to open a deal that
    // may already be in the book. Retry reloads the same read.
    const onRetry = vi.fn();
    render(<PipelineCard rows={[]} onDrill={vi.fn()} rowsFailed onRetry={onRetry} />);

    const card = screen.getByRole('region', { name: 'Pipeline' });
    expect(within(card).queryByText('No open bids.')).toBeNull();
    expect(within(card).queryByText(/0 open of 0 bids/)).toBeNull();
    expect(within(card).queryByRole('button', { name: 'Table' })).toBeNull();
    expect(card.querySelector('.viz-figure')?.getAttribute('role')).toBeNull();
    expect(within(card).getByRole('alert')).toBeTruthy();
    expect(within(card).getByRole('heading', { name: "Couldn't load bids" })).toBeTruthy();
    expect(within(card).getByText('Please try again.')).toBeTruthy();
    const retry = within(card).getByRole('button', { name: 'Retry' });
    for (const token of RETRY_CLASS) expect(retry.className).toContain(token);
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('holds the pipeline chart while the bid read is loading', () => {
    // WHY: the first paint is not an empty pipeline. Zero chips would land
    // before the rows and then jump.
    render(<PipelineCard rows={[]} onDrill={vi.fn()} rowsPending />);

    const card = screen.getByRole('region', { name: 'Pipeline' });
    expect(within(card).queryByText('No open bids.')).toBeNull();
    expect(within(card).queryByText(/0 open of 0 bids/)).toBeNull();
    expect(within(card).queryByRole('button', { name: 'Table' })).toBeNull();
    expect(within(card).getByRole('img', { name: 'Loading bids' })).toBeTruthy();
    expect(card.querySelectorAll('[aria-busy="true"]').length).toBeGreaterThan(0);
    expect(card.querySelectorAll('.bs-shimmer').length).toBe(3);
  });

  it('says there are no open bids only after a successful empty read', () => {
    // WHY: empty is a real result. That sentence stays for that case only.
    render(<PipelineCard rows={[]} onDrill={vi.fn()} />);

    const card = screen.getByRole('region', { name: 'Pipeline' });
    expect(within(card).getByText('No open bids.')).toBeTruthy();
    expect(within(card).queryByRole('alert')).toBeNull();
    expect(card.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('keeps the last pipeline when a later refresh fails', () => {
    // WHY: a failed refresh is not a new empty book.
    render(<PipelineCard rows={[bid()]} onDrill={vi.fn()} rowsFailed onRetry={vi.fn()} />);

    const card = screen.getByRole('region', { name: 'Pipeline' });
    expect(within(card).queryByText('No open bids.')).toBeNull();
    expect(within(card).queryByRole('alert')).toBeNull();
    expect(card.textContent).toContain('1 open of 1 bids');
  });

  it('does not call a failed bid read a clear desk', () => {
    // WHY: "Nothing waiting. Nice." is a result. A failed read has not
    // checked past-due bids.
    const onRetry = vi.fn();
    render(
      <MemoryRouter>
        <NeedsYou rows={[]} overdueTasks={0} rowsFailed onRetry={onRetry} />
      </MemoryRouter>,
    );

    expect(screen.queryByText('Nothing waiting. Nice.')).toBeNull();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain("Couldn't load bids");
    const retry = screen.getByRole('button', { name: 'Retry' });
    for (const token of RETRY_CLASS) expect(retry.className).toContain(token);
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('holds Needs you while the bid read is loading', () => {
    // WHY: an empty sentence before the rows arrive is the same false all-clear.
    render(
      <MemoryRouter>
        <NeedsYou rows={[]} overdueTasks={0} pending />
      </MemoryRouter>,
    );

    expect(screen.queryByText('Nothing waiting. Nice.')).toBeNull();
    expect(screen.getByTestId('needs-you-placeholder')).toBeTruthy();
  });

  it('keeps a waiting task and still says the bid read failed', () => {
    // WHY: an overdue task is real. It does not prove the bid read succeeded.
    render(
      <MemoryRouter>
        <NeedsYou rows={[]} overdueTasks={2} rowsFailed onRetry={vi.fn()} />
      </MemoryRouter>,
    );

    expect(screen.getByText('2 overdue tasks')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain("Couldn't load bids");
    expect(screen.queryByText('Nothing waiting. Nice.')).toBeNull();
  });

  it('says nothing is waiting only after a successful empty read', () => {
    // WHY: a quiet book is a result. The sentence stays for that case only.
    render(
      <MemoryRouter>
        <NeedsYou rows={[]} overdueTasks={0} />
      </MemoryRouter>,
    );

    expect(screen.getByText('Nothing waiting. Nice.')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not call a failed bid read a month with no bids', () => {
    // WHY: the close-month chart is drawn from the bid rows. "No dated bids
    // yet" is that read succeeding with none.
    const onRetry = vi.fn();
    render(
      <DashboardHero
        rows={[]}
        openValue={1_000_000}
        weighted={500_000}
        openCount={2}
        rowsFailed
        onRetry={onRetry}
      />,
    );

    const card = screen.getByTestId('dashboard-hero');
    expect(within(card).queryByText('No dated bids yet.')).toBeNull();
    expect(within(card).getByRole('alert')).toBeTruthy();
    expect(within(card).getByRole('heading', { name: "Couldn't load bids" })).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(within(card).queryByRole('button', { name: /show the open bids/i })).toBeNull();
  });

  it('does not draw an empty performance book while bids are unread', () => {
    // WHY: win rate, revenue and top accounts are the same rows. "Needs closed
    // bids in two quarters" is a result, not a failed read.
    const { rerender } = render(<PerformanceCard rows={[]} onDrill={vi.fn()} rowsFailed onRetry={vi.fn()} />);

    const card = screen.getByTestId('dashboard-performance');
    expect(within(card).queryByText('Needs closed bids in two quarters.')).toBeNull();
    expect(within(card).queryByRole('tab')).toBeNull();
    expect(within(card).getByRole('alert')).toBeTruthy();

    rerender(<PerformanceCard rows={[]} onDrill={vi.fn()} rowsPending />);
    expect(within(card).queryByText('Needs closed bids in two quarters.')).toBeNull();
    expect(within(card).queryByRole('tab')).toBeNull();
    expect(within(card).getByRole('img', { name: 'Loading bids' })).toBeTruthy();
  });
});

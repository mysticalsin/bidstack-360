// A bid list that is still loading, or that failed, is not an empty book.
// The cockpit must not say "No open bids", print zero status chips, or call
// won-this-year 0 until that read has settled. A successful empty list may.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { OppRow } from '@/components/viz/viz-data';

import { DashboardHero, PerformanceCard, PipelineCard } from './DashboardVisuals';

const openBid: OppRow = {
  id: 'o1',
  stage: 's1_ongoing',
  value: 2_700_000,
  dueDate: '2026-09-15',
  customer: 'Northwind',
};

const closedBids: OppRow[] = [
  { id: 'a', stage: 'closed_won', value: 100, dueDate: '2026-02-10', closedAt: '2026-02-10T00:00:00Z', customer: 'Acme' },
  { id: 'b', stage: 'closed_lost', value: 50, dueDate: '2026-05-10', closedAt: '2026-05-10T00:00:00Z', customer: 'Beta' },
];

afterEach(cleanup);

describe('cockpit bid list before it settles', () => {
  it('does not call an in-flight list an empty book or a zero win', () => {
    const { container } = render(
      <DashboardHero
        rows={[]}
        openValue={11_900_000}
        weighted={7_100_000}
        openCount={6}
        rowsPending
        onDrill={vi.fn()}
      />,
    );

    // The open-pipeline figure comes from the settled summary, so it may show.
    // Won-this-year is counted from the bid list and must not flash 0.
    expect(screen.getByRole('button', { name: /open pipeline 11\.9M/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /won this year 0/i })).toBeNull();
    expect(container.querySelector('[aria-label*="Won so far this year 0"]')).toBeNull();
    expect(screen.queryByText('No dated bids yet.')).toBeNull();
    expect(screen.getByText('Loading the bid list.')).toBeTruthy();
  });

  it('does not call a failed bid list an empty book', () => {
    const onRetry = vi.fn();
    render(
      <DashboardHero
        rows={[]}
        openValue={11_900_000}
        weighted={7_100_000}
        openCount={6}
        rowsFailed
        onRetry={onRetry}
        onDrill={vi.fn()}
      />,
    );

    expect(screen.queryByText('No dated bids yet.')).toBeNull();
    expect(screen.queryByRole('button', { name: /won this year 0/i })).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain("Couldn't load the bid list");
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('holds the pipeline empty sentence and the zero chips until the list settles', () => {
    render(<PipelineCard rows={[]} onDrill={vi.fn()} rowsPending />);
    const card = screen.getByTestId('dashboard-pipeline');
    expect(within(card).queryByText('No open bids.')).toBeNull();
    expect(within(card).queryByRole('button', { name: /^Open/ })).toBeNull();
    expect(card.textContent).not.toContain('0 open of 0');
    expect(within(card).getByText('Loading the bid list.')).toBeTruthy();
  });

  it('offers a retry on the pipeline card when the bid list fails', () => {
    const onRetry = vi.fn();
    render(<PipelineCard rows={[]} onDrill={vi.fn()} rowsFailed onRetry={onRetry} />);
    const card = screen.getByTestId('dashboard-pipeline');
    expect(within(card).queryByText('No open bids.')).toBeNull();
    expect(within(card).getByRole('alert').textContent).toContain("Couldn't load the bid list");
    fireEvent.click(within(card).getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('says there are no open bids only after a successful empty read', () => {
    render(<PipelineCard rows={[]} onDrill={vi.fn()} />);
    const card = screen.getByTestId('dashboard-pipeline');
    expect(within(card).getByText('No open bids.')).toBeTruthy();
    expect(within(card).getByRole('button', { name: /^Open 0/ })).toBeTruthy();
  });

  it('shows the stage mix once the list has bids', () => {
    render(<PipelineCard rows={[openBid]} onDrill={vi.fn()} />);
    const card = screen.getByTestId('dashboard-pipeline');
    expect(within(card).queryByText('No open bids.')).toBeNull();
    expect(card.textContent).toContain('1 open of 1 bids');
  });

  it('does not tell performance the book is empty while the bid list is loading', () => {
    render(<PerformanceCard rows={[]} rowsPending />);
    expect(screen.queryByText('Needs closed bids in two quarters.')).toBeNull();
    expect(screen.queryByText(/No target set yet/)).toBeNull();
    expect(screen.getByText('Loading the bid list.')).toBeTruthy();
  });

  it('does not invent a missing commit target while the forecast is loading', () => {
    render(<PerformanceCard rows={closedBids} projectionPending />);
    expect(screen.queryByText(/No target set yet/)).toBeNull();
    expect(screen.getByText('Loading the forecast')).toBeTruthy();
  });

  it('retries a failed forecast instead of saying no target is set', () => {
    const onRetry = vi.fn();
    render(<PerformanceCard rows={closedBids} projectionFailed onProjectionRetry={onRetry} />);
    expect(screen.queryByText(/No target set yet/)).toBeNull();
    expect(screen.getByText(/Couldn't load the forecast/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('says no commit target is set only after the forecast settles without one', () => {
    render(<PerformanceCard rows={closedBids} projection={{ periods: [] }} />);
    expect(screen.getByText(/No target set yet/)).toBeTruthy();
  });

  it('names the commit target once the forecast has settled', () => {
    render(
      <PerformanceCard
        rows={closedBids}
        projection={{
          periods: [
            {
              label: 'Q1 2026',
              weightedMicros: 0,
              wonMicros: 0,
              openMicros: 0,
              manualCommitMicros: 11_900_000,
            },
          ],
        }}
      />,
    );
    expect(screen.getByText(/Commit target 11\.9/)).toBeTruthy();
  });
});

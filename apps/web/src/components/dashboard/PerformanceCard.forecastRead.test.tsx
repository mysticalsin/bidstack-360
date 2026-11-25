// The revenue tab is the forecast. Demo wins already have close dates, so a
// forecast read that has not settled still draws those wins and says there is
// no commit target. That reads as a finished forecast with nothing to compare.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PerformanceCard } from './DashboardVisuals';

const rows = [
  { id: 'a', stage: 'closed_won', value: 100, dueDate: '2026-02-10', closedAt: '2026-02-10T00:00:00Z', customer: 'Acme' },
  { id: 'b', stage: 'closed_lost', value: 50, dueDate: '2026-05-10', closedAt: '2026-05-10T00:00:00Z', customer: 'Beta' },
  { id: 'c', stage: 's2_sent', value: 300, dueDate: '2026-12-01', customer: 'Acme' },
];

const settled = {
  periods: [
    {
      label: 'Q4 2026',
      weightedMicros: 1_000_000,
      wonMicros: 0,
      openMicros: 2_000_000,
      manualCommitMicros: null,
    },
  ],
};

function revenueSection() {
  return screen.getByRole('heading', { name: 'Revenue and forecast' }).closest('section')!;
}

afterEach(cleanup);

describe('dashboard revenue forecast read', () => {
  it('does not call a loading forecast a book with no target', () => {
    // WHY: the open book is still on its way. "No target set yet" plus the
    // wins already on screen is a finished answer.
    render(<PerformanceCard rows={rows} pending />);

    const revenue = revenueSection();
    expect(revenue.textContent).toContain('Loading the forecast');
    expect(revenue.textContent).not.toContain('No target set yet');
    const figure = revenue.querySelector('figure');
    // The figure must not be an image: an image hides the loading status and
    // would keep the won-quarter name as the only thing a reader hears.
    expect(figure?.getAttribute('role')).not.toBe('img');
    expect(figure?.getAttribute('aria-label')).toBe('Loading the forecast');
    expect(figure?.getAttribute('aria-label')).not.toContain('Q1 2026');
    expect(revenue.querySelector('[data-testid="dashboard-forecast-placeholder"]')).toBeTruthy();
  });

  it('says the forecast failed and does not invent an empty target', () => {
    // WHY: a failed projection is not "add a commit forecast". Retry repeats
    // the same read. The words have to be readable, and the control has to
    // take a keyboard focus ring.
    const onRetry = vi.fn();
    render(<PerformanceCard rows={rows} failed onRetry={onRetry} />);

    const revenue = revenueSection();
    expect(revenue.textContent).toContain("Couldn't load the forecast");
    expect(revenue.textContent).toContain('Please try again.');
    expect(revenue.textContent).not.toContain('No target set yet');
    const figure = revenue.querySelector('figure');
    expect(figure?.getAttribute('role')).not.toBe('img');
    const alert = revenue.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Couldn't load the forecast");
    const retry = screen.getByRole('button', { name: 'Retry' });
    expect(retry.className).toContain('min-h-11');
    expect(retry.className).toContain('focus-visible:ring-2');
    expect(retry.className).toContain('text-[var(--fg-primary)]');
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('says there is no commit target only after the forecast has settled', () => {
    // WHY: empty is a real result. The open quarter is on the chart, and the
    // missing commit is the only thing the sentence is about.
    render(<PerformanceCard rows={rows} projection={settled} />);

    const revenue = revenueSection();
    expect(revenue.textContent).toContain('No target set yet');
    expect(revenue.querySelector('figure')?.getAttribute('aria-label')).toContain('Q4 2026');
    expect(revenue.querySelector('[role="alert"]')).toBeNull();
  });

  it('keeps the forecast already on screen when a later refresh fails', () => {
    // WHY: a failed refresh is not a new empty book.
    render(<PerformanceCard rows={rows} projection={settled} failed />);

    const revenue = revenueSection();
    expect(revenue.querySelector('figure')?.getAttribute('aria-label')).toContain('Q4 2026');
    expect(revenue.textContent).not.toContain("Couldn't load the forecast");
  });
});

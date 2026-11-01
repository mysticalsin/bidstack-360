import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const overdue = vi.hoisted(() => ({
  data: undefined as { items: Array<{ id: string; customer: string | null; stage: string }>; nextCursor: string | null } | undefined,
  isLoading: false,
  isError: false,
}));
const useOpportunities = vi.hoisted(() => vi.fn(() => overdue));

vi.mock('@/hooks/useOpportunities', () => ({
  useOpportunities,
}));

import { NeedsYou } from './DashboardVisuals';

afterEach(() => {
  cleanup();
  overdue.data = undefined;
  overdue.isLoading = false;
  overdue.isError = false;
  useOpportunities.mockClear();
});

function renderNeeds() {
  return render(
    <MemoryRouter>
      <NeedsYou overdueTasks={0} />
    </MemoryRouter>,
  );
}

describe('NeedsYou past-due bids', () => {
  it('asks for open overdue bids instead of the chart sample', () => {
    // WHY: the chart rows are the latest 100 updates. A past-due bid outside that page was invisible.
    overdue.data = { items: [], nextCursor: null };
    renderNeeds();
    expect(useOpportunities).toHaveBeenCalledWith({ overdue: true, excludeClosed: true, limit: 200 });
    expect(screen.getByText('Nothing waiting. Nice.')).toBeTruthy();
  });

  it('counts the overdue page and says when another page exists', () => {
    overdue.data = {
      items: [
        { id: 'a', customer: 'Acme', stage: 's2_sent' },
        { id: 'won', customer: 'Old', stage: 'closed_won' },
      ],
      nextCursor: 'more',
    };
    renderNeeds();
    const link = screen.getByRole('link', { name: /At least 1 open bid past due date/ });
    expect(link.getAttribute('href')).toBe('/opportunities?due=overdue');
    expect(screen.queryByText(/Old/)).toBeNull();
  });

  it('does not call a loading page a clear desk', () => {
    overdue.isLoading = true;
    renderNeeds();
    expect(screen.getByText('Checking past-due bids.')).toBeTruthy();
    expect(screen.queryByText('Nothing waiting. Nice.')).toBeNull();
  });
});

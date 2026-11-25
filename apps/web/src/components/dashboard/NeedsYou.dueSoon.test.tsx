// The demo sign-in book dates open follow-ups a few days out (3, 4, 5, and 7)
// and marks the one already-late handover done. Home overdueTasks is then 0,
// so Needs you said "Nothing waiting. Nice." A week that still has open
// follow-ups is not an empty list.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { NeedsYou } from './DashboardVisuals';

const summary = vi.hoisted(() => ({
  data: undefined as undefined | { total: number; open: number; overdue: number; dueSoon: number },
  isLoading: false,
  isError: false,
}));

vi.mock('@/hooks/useTasks', () => ({
  useTaskSummary: () => summary,
}));

const futureBid = {
  id: 'op-0001',
  stage: 's2_sent',
  value: 1_200_000,
  dueDate: '2099-01-09',
  customer: 'Siemens',
};

function renderNeedsYou() {
  return render(
    <MemoryRouter>
      <NeedsYou rows={[futureBid]} overdueTasks={0} />
    </MemoryRouter>,
  );
}

afterEach(() => {
  summary.data = undefined;
  summary.isLoading = false;
  summary.isError = false;
  cleanup();
});

describe('Needs you when follow-ups are due this week', () => {
  it('names the open follow-ups instead of calling the demo week empty', () => {
    summary.data = { total: 5, open: 4, overdue: 0, dueSoon: 4 };
    renderNeedsYou();
    const link = screen.getByRole('link', { name: /4 follow-ups due this week/i });
    expect(link.getAttribute('href')).toBe('/tasks');
    expect(screen.queryByText('Nothing waiting. Nice.')).toBeNull();
  });

  it('uses the singular when one follow-up is due this week', () => {
    summary.data = { total: 1, open: 1, overdue: 0, dueSoon: 1 };
    renderNeedsYou();
    expect(screen.getByRole('link', { name: /1 follow-up due this week/i })).toBeTruthy();
    expect(screen.queryByText(/1 follow-ups/)).toBeNull();
  });

  it('keeps the quiet sentence when nothing is due and nothing is overdue', () => {
    summary.data = { total: 1, open: 0, overdue: 0, dueSoon: 0 };
    renderNeedsYou();
    expect(screen.getByText('Nothing waiting. Nice.')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /due this week/i })).toBeNull();
  });

  it('does not call the week empty while the follow-up count is still loading', () => {
    summary.isLoading = true;
    renderNeedsYou();
    expect(screen.queryByText('Nothing waiting. Nice.')).toBeNull();
    expect(screen.getByTestId('needs-you-placeholder')).toBeTruthy();
  });

  it('does not invent a due-soon line when the follow-up count cannot be read', () => {
    summary.isError = true;
    renderNeedsYou();
    expect(screen.getByText('Nothing waiting. Nice.')).toBeTruthy();
  });
});

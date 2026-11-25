import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import type { OppRow } from '@/components/viz/viz-data';

import { NeedsYou } from './DashboardVisuals';

const rows: OppRow[] = [
  { id: 'late', stage: 's2_sent', value: 2_150_000, dueDate: '2026-09-15', customer: 'DNB Bank' },
  { id: 'today', stage: 's1_ongoing', value: 320_000, dueDate: '2026-11-25', customer: 'Today Co' },
  { id: 'won', stage: 'closed_won', value: 410_000, dueDate: '2026-04-28', customer: 'Aritzia' },
];

function renderNeeds(extra: OppRow[] = rows) {
  return render(
    <MemoryRouter>
      <NeedsYou rows={extra} overdueTasks={0} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-25T18:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('NeedsYou past-due bids', () => {
  it('opens the overdue bid list for an open bid whose close day has passed', () => {
    // WHY: demo close dates sit in April–September 2026. On a later day the
    // cockpit says those bids are past due, and the click has to land on that
    // slice. The unfiltered book still includes decided bids and bids that
    // are not late, so the lead has to find the Overdue chip again.
    renderNeeds();
    const link = screen.getByRole('link', { name: /1 open bid past due date/i });
    expect(link.getAttribute('href')).toBe('/opportunities?due=overdue');
    expect(screen.queryByText(/Today Co/)).toBeNull();
    expect(screen.queryByText(/Aritzia/)).toBeNull();
  });

  it('does not call a bid due today past due', () => {
    renderNeeds([{ id: 'today', stage: 's2_sent', value: 100, dueDate: '2026-11-25', customer: 'Today Co' }]);
    expect(screen.queryByRole('link', { name: /past due/i })).toBeNull();
    expect(screen.getByText('Nothing waiting. Nice.')).toBeTruthy();
  });
});

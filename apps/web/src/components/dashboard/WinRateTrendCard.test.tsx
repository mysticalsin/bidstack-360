import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { PerformanceCard } from './DashboardVisuals';

// The demo book closes one won bid and one lost bid in the same quarter
// (Aritzia and NOS, both April 2026). A trend line needs two quarters, but
// the win rate of that closed book is already known. An open bid in a later
// month must not enter the rate.
const demoBook = [
  { id: 'won', stage: 'closed_won', value: 410_000, dueDate: '2026-04-28', closedAt: '2026-04-28', customer: 'Aritzia' },
  { id: 'lost', stage: 'closed_lost', value: 1_900_000, dueDate: '2026-04-12', closedAt: '2026-04-12', customer: 'NOS' },
  { id: 'open', stage: 's4_negotiation', value: 4_800_000, dueDate: '2026-06-30', customer: 'Rush University System for Health' },
];

const twoQuarters = [
  { id: 'q1', stage: 'closed_won', value: 100, dueDate: '2026-02-10', closedAt: '2026-02-10T00:00:00Z', customer: 'Acme' },
  { id: 'q2', stage: 'closed_lost', value: 50, dueDate: '2026-05-10', closedAt: '2026-05-10T00:00:00Z', customer: 'Beta' },
];

afterEach(cleanup);

function openWinRate(rows: typeof demoBook) {
  render(<PerformanceCard rows={rows} />);
  fireEvent.click(screen.getByRole('tab', { name: 'Win rate' }));
  // Revenue stays mounted beside this panel, so the rate is read from Win rate only.
  return within(screen.getByRole('tabpanel', { name: 'Win rate' }));
}

describe('Performance win rate', () => {
  it('shows the closed-book rate when the demo book has only one quarter', () => {
    const panel = openWinRate(demoBook);
    expect(panel.getByText('50%')).toBeTruthy();
    expect(panel.getByText('1 of 2 closed bids · Q2 2026')).toBeTruthy();
    expect(panel.queryByText('Needs closed bids in two quarters.')).toBeNull();
  });

  it('says there are no closed bids when every bid is still open', () => {
    const panel = openWinRate([demoBook[2]!]);
    expect(panel.getByText('No closed bids.')).toBeTruthy();
    expect(panel.queryByText('Needs closed bids in two quarters.')).toBeNull();
  });

  it('keeps the trend chart when closed bids span two quarters', () => {
    const panel = openWinRate(twoQuarters);
    expect(panel.queryByTestId('win-rate-single-quarter')).toBeNull();
    expect(panel.queryByText('Needs closed bids in two quarters.')).toBeNull();
    expect(panel.getByRole('img', { name: /Q1 2026: 100%/ })).toBeTruthy();
  });
});

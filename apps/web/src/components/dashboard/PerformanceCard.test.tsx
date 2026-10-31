import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PerformanceCard } from './DashboardVisuals';

const rows = [
  { id: 'a', stage: 'closed_won', value: 100, dueDate: '2026-02-10', closedAt: '2026-02-10T00:00:00Z', customer: 'Acme' },
  { id: 'b', stage: 'closed_lost', value: 50, dueDate: '2026-05-10', closedAt: '2026-05-10T00:00:00Z', customer: 'Beta' },
  { id: 'c', stage: 's2_sent', value: 300, dueDate: '2026-12-01', customer: 'Acme' },
];

describe('PerformanceCard', () => {
  it('puts revenue, win rate and top accounts behind one accessible tab list', () => {
    render(<PerformanceCard rows={rows} />);
    expect(screen.getByRole('heading', { name: 'Performance', level: 2 })).toBeTruthy();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Revenue', 'Win rate', 'Top accounts']);
    expect(tabs[0]!.getAttribute('aria-selected')).toBe('true');
    // Inner views are level-3 headings: no card-in-card heading clash.
    expect(screen.getByRole('heading', { name: 'Top accounts', level: 3 })).toBeTruthy();
    fireEvent.click(tabs[1]!);
    expect(screen.getAllByRole('tab')[1]!.getAttribute('aria-selected')).toBe('true');
  });
});

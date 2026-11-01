import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DashboardHero, PerformanceCard, PipelineCard, TopAccountsBarCard } from './DashboardVisuals';

const rows = [
  { id: 'a', stage: 'closed_won', value: 100, dueDate: '2026-02-10', closedAt: '2026-02-10T00:00:00Z', customer: 'Acme', companyId: 'co-acme' },
  { id: 'b', stage: 'closed_lost', value: 50, dueDate: '2026-05-10', closedAt: '2026-05-10T00:00:00Z', customer: 'Beta', companyId: 'co-beta' },
  { id: 'c', stage: 's2_sent', value: 300, dueDate: '2026-12-01', customer: 'Acme', companyId: 'co-acme' },
];

afterEach(cleanup);

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

  it('says the performance charts are the latest 100 updated bids when another page exists', () => {
    // WHY: these charts use the latest updated page. Without the note they read as the whole book.
    render(<PerformanceCard rows={rows} rowsCapped />);
    expect(screen.getByText('Revenue, win rate and top accounts from the latest 100 updated bids')).toBeTruthy();
    expect(screen.getByText(/Won bars from the latest 100 updated bids/)).toBeTruthy();
    expect(screen.getByText('Share of closed bids won in the latest 100 updated bids')).toBeTruthy();
    expect(screen.getByText('Won plus open value in the latest 100 updated bids')).toBeTruthy();
  });
});

describe('top account bars', () => {
  it('opens the company id when two accounts share a customer name', () => {
    // WHY: the chip used the customer string, so the larger Acme opened both companies.
    const onDrill = vi.fn();
    render(
      <TopAccountsBarCard
        rows={[
          { id: 'small', companyId: 'co-1', customer: 'Acme', stage: 's2_sent', value: 10, dueDate: null },
          { id: 'large', companyId: 'co-2', customer: 'Acme', stage: 's2_sent', value: 40, dueDate: null },
          { id: 'loose', companyId: null, customer: 'Acme', stage: 's2_sent', value: 90, dueDate: null },
        ]}
        onDrill={onDrill}
      />,
    );
    const chips = screen.getAllByRole('button', { name: /Acme/ });
    expect(chips).toHaveLength(2);
    fireEvent.click(chips[0]!);
    expect(onDrill).toHaveBeenCalledWith({ status: 'all', companyId: 'co-2', account: 'Acme' });
  });

  it('does not draw an unlinked bid as an account', () => {
    render(
      <TopAccountsBarCard
        rows={[{ id: 'loose', companyId: null, customer: 'Acme', stage: 's2_sent', value: 90, dueDate: null }]}
      />,
    );
    expect(screen.getByText('No bids linked to a company.')).toBeTruthy();
  });
});

describe('chart snapshot captions', () => {
  it('names the won-this-year chart as the latest 100 when the snapshot continues', () => {
    render(<DashboardHero rows={rows} openValue={300} weighted={100} openCount={1} rowsCapped />);
    expect(screen.getByText('Won this year · latest 100 bids')).toBeTruthy();
    expect(screen.getByText(/Older bids are outside this chart/)).toBeTruthy();
    expect(screen.queryByText('Won this year')).toBeNull();
  });

  it('keeps the pipeline caption whole when the snapshot is complete', () => {
    render(<PipelineCard rows={rows} onDrill={() => {}} />);
    expect(screen.getByText('Where your open bids sit today. Select a stage or a status to see the bids.')).toBeTruthy();
    expect(screen.queryByText(/Latest 100 updated bids/)).toBeNull();
  });
});

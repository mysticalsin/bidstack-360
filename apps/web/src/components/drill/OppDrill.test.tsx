import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import { filterOpps, type OppDrillFilter } from './filterOpps';
import { OppDrill } from './OppDrill';
import type { OppRow } from '@/components/viz/viz-data';

const rows: OppRow[] = [
  { id: 'a', name: 'Alpha rollout', customer: 'Acme', stage: 's4_negotiation', value: 500, probability: 50, dueDate: '2026-11-20' },
  { id: 'b', name: 'Beta pilot', customer: 'Beta', stage: 's1_lead', value: 100, probability: 10, dueDate: null },
  { id: 'c', name: 'Gamma renewal', customer: 'Acme', stage: 'closed_won', value: 300, dueDate: '2026-03-01', closedAt: '2026-03-01' },
];

afterEach(cleanup);

function Harness({ start }: { start: OppDrillFilter }) {
  const [f, setF] = useState<OppDrillFilter | null>(start);
  return (
    <MemoryRouter>
      <p>closed:{String(f === null)}</p>
      <OppDrill rows={rows} filter={f} onFilterChange={setF} onClose={() => setF(null)} />
    </MemoryRouter>
  );
}

const ciBook: OppRow[] = [
  { id: 'open', name: 'IT Modernization & MSP', customer: 'CI Financial', stage: 's3_technical_iteration', value: 1_240_000, dueDate: '2026-07-22' },
  { id: 'won', name: 'Zero Trust expansion', customer: 'CI Financial', stage: 'closed_won', value: 1_350_000, dueDate: '2026-09-01', closedAt: '2026-09-01' },
  { id: 'lost', name: 'Legacy app retirement', customer: 'CI Financial', stage: 'closed_lost', value: 300_000, dueDate: '2026-10-01', closedAt: '2026-10-01' },
];

describe('filterOpps', () => {
  it('filters by status, stage, account, year and search', () => {
    expect(filterOpps(rows, { status: 'open' }).map((o) => o.id)).toEqual(['a', 'b']);
    expect(filterOpps(rows, { stage: 's1_lead' }).map((o) => o.id)).toEqual(['b']);
    expect(filterOpps(rows, { account: 'acme' }).map((o) => o.id)).toEqual(['a', 'c']);
    expect(filterOpps(rows, { status: 'won', thisYear: true }, '', 2026).map((o) => o.id)).toEqual(['c']);
    expect(filterOpps(rows, {}, 'beta').map((o) => o.id)).toEqual(['b']);
  });

  it('keeps won and lost bids when the win-rate drill asks for the closed book', () => {
    // WHY: CI Financial's header says "Show won and lost". The open IT
    // modernization is still in flight. A drill of every bid puts that deal
    // in the closed record the win rate was counted from.
    expect(filterOpps(ciBook, { status: 'closed' }).map((o) => o.id)).toEqual(['won', 'lost']);
  });
});

describe('OppDrill', () => {
  it('shows the stage breakdown, drills into a stage and back via the trail', () => {
    render(<Harness start={{ status: 'open' }} />);
    const sheet = screen.getByTestId('opp-drill');
    expect(within(sheet).getByRole('heading', { name: 'By stage' })).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'S4 negotiation' }));
    expect(screen.getByRole('link', { name: 'Alpha rollout' }).getAttribute('href')).toBe('/opportunities/a');
    expect(screen.queryByRole('link', { name: 'Beta pilot' })).toBeNull();
    const trail = screen.getByRole('navigation', { name: 'Drill-down path' });
    fireEvent.click(within(trail).getByRole('button', { name: 'Open' }));
    expect(screen.getByRole('link', { name: 'Beta pilot' })).toBeTruthy();
    fireEvent.click(within(trail).getByRole('button', { name: 'Dashboard' }));
    expect(screen.getByText('closed:true')).toBeTruthy();
  });

  it('narrows to an account from a row', () => {
    render(<Harness start={{ status: 'all' }} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Acme' })[0]!);
    expect(screen.getByRole('link', { name: 'Gamma renewal' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Beta pilot' })).toBeNull();
  });

  it('shows the won and lost bids and leaves the open bid off that list', () => {
    render(
      <MemoryRouter>
        <OppDrill rows={ciBook} filter={{ status: 'closed' }} onFilterChange={() => undefined} onClose={() => undefined} rootLabel="CI Financial" />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Zero Trust expansion' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Legacy app retirement' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'IT Modernization & MSP' })).toBeNull();
  });
});

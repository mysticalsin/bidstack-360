import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import '@/i18n';

import { daysUntilDueUtc } from '@/components/ui/DueDateChip';
import type { OppRow } from '@/components/viz/viz-data';

import { filterOpps, type OppDrillFilter } from './filterOpps';
import { OppDrill } from './OppDrill';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const rows: OppRow[] = [
  { id: 'a', name: 'Alpha rollout', customer: 'Acme', stage: 's4_negotiation', value: 500, probability: 50, dueDate: '2026-11-20' },
  { id: 'b', name: 'Beta pilot', customer: 'Beta', stage: 's1_lead', value: 100, probability: 10, dueDate: null },
  { id: 'c', name: 'Gamma renewal', customer: 'Acme', stage: 'closed_won', value: 300, dueDate: '2026-03-01', closedAt: '2026-03-01' },
];

function Harness({ start }: { start: OppDrillFilter }) {
  const [f, setF] = useState<OppDrillFilter | null>(start);
  return (
    <MemoryRouter>
      <p>closed:{String(f === null)}</p>
      <OppDrill rows={rows} filter={f} onFilterChange={setF} onClose={() => setF(null)} />
    </MemoryRouter>
  );
}

describe('filterOpps', () => {
  it('filters by status, stage, account, year and search', () => {
    expect(filterOpps(rows, { status: 'open' }).map((o) => o.id)).toEqual(['a', 'b']);
    expect(filterOpps(rows, { stage: 's1_lead' }).map((o) => o.id)).toEqual(['b']);
    expect(filterOpps(rows, { account: 'acme' }).map((o) => o.id)).toEqual(['a', 'c']);
    expect(filterOpps(rows, { status: 'won', thisYear: true }, '', 2026).map((o) => o.id)).toEqual(['c']);
    expect(filterOpps(rows, {}, 'beta').map((o) => o.id)).toEqual(['b']);
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

  it('says an open bid is already late and stops the clock once the bid is won', () => {
    // WHY: Open pipeline opens this sheet. Demo bids are due in the summer of
    // 2026. On a later day a date such as "20 Nov 2026" still reads as a
    // scheduled close. The same sheet lists won bids; their deadline has
    // stopped, so a past due date must not be called overdue. The due day
    // itself is not late for the whole afternoon.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-25T18:00:00Z'));
    const book: OppRow[] = [
      { id: 'late', name: 'CI modernization', customer: 'CI Financial', stage: 's3_technical_iteration', value: 1240, probability: 65, dueDate: '2026-07-22' },
      { id: 'today', name: 'Logistec review', customer: 'Logistec', stage: 's1_ongoing', value: 320, probability: 35, dueDate: '2026-11-25' },
      { id: 'later', name: 'DNB landing zone', customer: 'DNB Bank', stage: 's1_ongoing', value: 2700, probability: 40, dueDate: '2099-01-15' },
      { id: 'won', name: 'Aritzia refresh', customer: 'Aritzia', stage: 'closed_won', value: 410, probability: 100, dueDate: '2026-04-28', closedAt: '2026-04-28' },
      { id: 'lost', name: 'NOS build-out', customer: 'NOS', stage: 'closed_lost', value: 1900, probability: 0, dueDate: '2026-04-12', closedAt: '2026-04-12' },
      { id: 'blank', name: 'Undated bid', customer: 'MAPFRE', stage: 's2_sent', value: 10, probability: 20, dueDate: null },
    ];
    render(
      <MemoryRouter>
        <OppDrill rows={book} filter={{ status: 'all' }} onFilterChange={() => {}} onClose={() => {}} />
      </MemoryRouter>,
    );
    const sheet = screen.getByTestId('opp-drill');
    const lateBy = Math.abs(daysUntilDueUtc('2026-07-22', new Date('2026-11-25T18:00:00Z')));
    expect(within(sheet).getByText(`${lateBy}d overdue`)).toBeTruthy();
    expect(within(sheet).getByText('Due today')).toBeTruthy();
    expect(within(sheet).getByText(/\d+d left/)).toBeTruthy();
    const won = within(sheet).getByRole('row', { name: /Aritzia refresh/ });
    expect(within(won).queryByText(/overdue/i)).toBeNull();
    expect(within(won).queryByText(/Due today/)).toBeNull();
    const lost = within(sheet).getByRole('row', { name: /NOS build-out/ });
    expect(within(lost).queryByText(/overdue/i)).toBeNull();
    const blank = within(sheet).getByRole('row', { name: /Undated bid/ });
    expect(within(blank).queryByText(/overdue|Due today|d left/)).toBeNull();
  });
});

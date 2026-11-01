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
  afterEach(cleanup);

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

  it('lists the larger micros bid first when the unit numbers match', () => {
    // WHY: both unit numbers collapse to the same safe integer, so subtracting them kept Low first.
    const low = (9007199254740992n * 1_000_000n).toString();
    const high = (9007199254740993n * 1_000_000n).toString();
    const huge: OppRow[] = [
      { id: 'low', name: 'Low book', customer: 'Low', stage: 's1_lead', value: 0, valueMicros: low, dueDate: null },
      { id: 'high', name: 'High book', customer: 'High', stage: 's2_sent', value: 0, valueMicros: high, dueDate: null },
    ];
    render(
      <MemoryRouter>
        <OppDrill rows={huge} filter={{ status: 'open' }} onFilterChange={() => {}} onClose={() => {}} />
      </MemoryRouter>,
    );
    const links = screen.getAllByRole('link').map((link) => link.textContent);
    expect(links.indexOf('High book')).toBeLessThan(links.indexOf('Low book'));
    const widths = [...document.querySelectorAll('.drill-bar')].map((bar) => (bar as HTMLElement).style.width);
    expect(widths).toContain('100%');
    expect(widths.some((width) => width !== '100%')).toBe(true);
  });

  it('says when the bid list is only the largest 100', () => {
    const many: OppRow[] = Array.from({ length: 101 }, (_, i) => ({
      id: `b${i}`,
      name: `Bid ${i}`,
      stage: 's1_lead',
      value: i + 1,
      dueDate: null,
    }));
    render(
      <MemoryRouter>
        <OppDrill rows={many} filter={{ status: 'open' }} onFilterChange={() => {}} onClose={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.getByText('Showing the largest 100 of 101.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Bid 100' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Bid 0' })).toBeNull();
  });
});

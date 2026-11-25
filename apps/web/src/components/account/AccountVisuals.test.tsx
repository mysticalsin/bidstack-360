// The deals block is what a salesperson checks before a call. A pipeline that
// is still loading, or a people map that failed, must not read as an empty
// book: "0 open bids" and "Add a contact" send them away from a live account.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import type { OppRow } from '@/components/viz/viz-data';
import { mockMatchMedia } from '@/test/matchMedia';

type OppQuery = {
  data: { items: OppRow[] } | undefined;
  isSuccess: boolean;
  isError: boolean;
  refetch: ReturnType<typeof vi.fn>;
};

type Person = {
  id: string;
  name: string;
  title: string | null;
  standing: string;
  reportsToContactId: string | null;
};

type PeopleQuery = {
  data: { people: Person[] } | undefined;
  isSuccess: boolean;
  isError: boolean;
  refetch: ReturnType<typeof vi.fn>;
};

const state = vi.hoisted(() => ({
  opps: {
    data: undefined as { items: OppRow[] } | undefined,
    isSuccess: false,
    isError: false,
    refetch: vi.fn(),
  },
  people: {
    data: undefined as { people: Person[] } | undefined,
    isSuccess: false,
    isError: false,
    refetch: vi.fn(),
  },
}));

vi.mock('@/hooks/useOpportunityRows', () => ({
  useOpportunityRows: () => state.opps,
}));

vi.mock('@/hooks/useAccountPeople', () => ({
  usePeopleMap: () => state.people,
}));

import { AccountVisuals } from './AccountVisuals';

const COMPANY = 'Northwind';

function settledOpps(items: OppRow[]): OppQuery {
  return { data: { items }, isSuccess: true, isError: false, refetch: vi.fn() };
}

function settledPeople(people: Person[]): PeopleQuery {
  return { data: { people }, isSuccess: true, isError: false, refetch: vi.fn() };
}

function renderDeals() {
  const onDrill = vi.fn();
  render(
    <MemoryRouter>
      <AccountVisuals companyId="company-1" companyName={COMPANY} onDrill={onDrill} />
    </MemoryRouter>,
  );
  return onDrill;
}

beforeEach(() => {
  mockMatchMedia({ '(prefers-reduced-motion: reduce)': true });
  state.opps = { data: undefined, isSuccess: false, isError: false, refetch: vi.fn() };
  state.people = settledPeople([]);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AccountVisuals deals section', () => {
  it('does not call a still-loading pipeline an empty book', () => {
    state.people = settledPeople([]);
    renderDeals();

    expect(screen.queryByText('No open bids for this account.')).toBeNull();
    expect(screen.queryByText('0 open bids')).toBeNull();
    expect(screen.queryByLabelText(/No open bids for this account/)).toBeNull();
    expect(screen.getByLabelText('Loading the pipeline for this account.')).toBeTruthy();
    // The people map already settled, so its empty state stays.
    expect(screen.getByRole('link', { name: 'Add a contact' })).toBeTruthy();
  });

  it('does not offer to add a contact while the people map is still loading', () => {
    state.opps = settledOpps([]);
    state.people = { data: undefined, isSuccess: false, isError: false, refetch: vi.fn() };
    renderDeals();

    expect(screen.queryByRole('link', { name: 'Add a contact' })).toBeNull();
    expect(screen.queryByText(/No contacts yet/)).toBeNull();
    expect(screen.queryByLabelText('No contacts yet')).toBeNull();
    expect(screen.getByLabelText('Loading contacts for this account.')).toBeTruthy();
    // The pipeline already settled empty, so the zero is a real one.
    expect(screen.getByText('0 open bids')).toBeTruthy();
    expect(screen.getByText('No open bids for this account.')).toBeTruthy();
  });

  it('retries a failed pipeline read instead of describing it as empty', () => {
    state.opps = { data: undefined, isSuccess: false, isError: true, refetch: vi.fn() };
    renderDeals();

    expect(screen.queryByText('No open bids for this account.')).toBeNull();
    expect(screen.queryByText('0 open bids')).toBeNull();
    expect(screen.getByLabelText('Could not load the pipeline for this account.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading the pipeline' }));
    expect(state.opps.refetch).toHaveBeenCalledTimes(1);
  });

  it('retries a failed people map instead of sending the reader to add a contact', () => {
    state.opps = settledOpps([]);
    state.people = { data: undefined, isSuccess: false, isError: true, refetch: vi.fn() };
    renderDeals();

    expect(screen.queryByRole('link', { name: 'Add a contact' })).toBeNull();
    expect(screen.queryByText(/No contacts yet/)).toBeNull();
    expect(screen.getByLabelText('Could not load contacts for this account.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading contacts' }));
    expect(state.people.refetch).toHaveBeenCalledTimes(1);
  });

  it('shows a real zero and the add-contact link only after both reads settle empty', () => {
    state.opps = settledOpps([]);
    state.people = settledPeople([]);
    renderDeals();

    expect(screen.getByText('0 open bids')).toBeTruthy();
    expect(screen.getByText('No open bids for this account.')).toBeTruthy();
    expect(screen.getByText(/No contacts yet/)).toBeTruthy();
    const add = screen.getByRole('link', { name: 'Add a contact' });
    expect(add.getAttribute('href')).toBe('/contacts');
  });

  it('counts only this account once the bid list has settled', () => {
    state.opps = settledOpps([
      { id: 'open-1', stage: 's2_sent', value: 2_000_000, dueDate: '2026-12-01', customer: 'Northwind', name: 'Portal refresh' },
      { id: 'other', stage: 's1_lead', value: 9_000_000, dueDate: '2026-12-01', customer: 'Contoso', name: 'Other logo' },
      { id: 'won-1', stage: 'closed_won', value: 1_000_000, dueDate: '2026-06-01', customer: 'northwind', name: 'Prior award' },
    ]);
    state.people = settledPeople([
      { id: 'p-1', name: 'Ada North', title: 'Buyer', standing: 'evidenced', reportsToContactId: null },
    ]);
    const onDrill = renderDeals();

    expect(screen.queryByText('No open bids for this account.')).toBeNull();
    expect(screen.getByText('1 open bid')).toBeTruthy();
    expect(screen.queryByText('2 open bids')).toBeNull();
    expect(screen.getByText('Ada North')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Open\s+1/ }));
    expect(onDrill).toHaveBeenCalledWith({ status: 'open' });
    fireEvent.click(screen.getByRole('button', { name: /Won\s+1/ }));
    expect(onDrill).toHaveBeenCalledWith({ status: 'won' });
  });
});

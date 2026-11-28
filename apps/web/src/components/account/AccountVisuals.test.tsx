// A people read that has not settled is not an empty account. The relationship
// map may say "No contacts yet" only after the read succeeds with no one.
// The reports-to cell opens the manager's contact when that id is a uuid.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

type Person = {
  id: string;
  name: string;
  title: string | null;
  standing: string;
  reportsToContactId: string | null;
};

type PeopleRead = {
  data?: { people: Person[] };
  isPending: boolean;
  isLoading: boolean;
  isError: boolean;
  isSuccess: boolean;
  refetch: ReturnType<typeof vi.fn>;
};

const people = vi.hoisted(() => ({
  state: {
    data: undefined,
    isPending: true,
    isLoading: true,
    isError: false,
    isSuccess: false,
    refetch: vi.fn(),
  } as PeopleRead,
}));

vi.mock('@/hooks/useAccountPeople', () => ({
  usePeopleMap: () => people.state,
}));

vi.mock('@/hooks/useOpportunityRows', () => ({
  useOpportunityRows: () => ({ data: { items: [] }, isSuccess: true, isError: false, isPending: false }),
}));

import { AccountVisuals } from './AccountVisuals';

const ADA = '11111111-1111-4111-8111-111111111111';
const MGR = '33333333-3333-4333-8333-333333333333';
const ORPHAN = '44444444-4444-4444-8444-444444444444';
const COMPANY = '22222222-2222-4222-8222-222222222222';

function person(
  id: string,
  name: string,
  reportsToContactId: string | null = null,
  title: string | null = 'Buyer',
): Person {
  return { id, name, title, standing: 'evidenced', reportsToContactId };
}

function settled(list: Person[], refetch = vi.fn()): PeopleRead {
  return {
    data: { people: list },
    isPending: false,
    isLoading: false,
    isError: false,
    isSuccess: true,
    refetch,
  };
}

function renderMap() {
  render(
    <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <AccountVisuals companyId={COMPANY} companyName="Northwind" />
    </MemoryRouter>,
  );
}

function mapRegion() {
  return screen.getByRole('region', { name: 'Relationship map' });
}

afterEach(() => {
  people.state = settled([]);
  cleanup();
});

describe('account relationship map people read', () => {
  it('shows a loading skeleton instead of an empty contact list', () => {
    // WHY: a read that has not finished is not an empty account. "No contacts yet"
    // would send someone to add a person who may already be on the account.
    people.state = {
      data: undefined,
      isPending: true,
      isLoading: true,
      isError: false,
      isSuccess: false,
      refetch: vi.fn(),
    };
    renderMap();

    const map = mapRegion();
    expect(screen.getByRole('region', { name: 'Pipeline by stage' })).toBeTruthy();
    expect(within(map).queryByText(/No contacts yet/)).toBeNull();
    expect(within(map).queryByRole('link', { name: 'Add a contact' })).toBeNull();
    expect(within(map).queryByRole('img', { name: 'No contacts yet' })).toBeNull();
    expect(within(map).queryByText(/0 people/)).toBeNull();
    expect(within(map).queryByRole('button', { name: 'Table' })).toBeNull();
    expect(within(map).getByRole('img', { name: 'Loading contacts' })).toBeTruthy();
    expect(map.querySelectorAll('[aria-busy="true"]').length).toBeGreaterThan(0);
    expect(map.querySelectorAll('.bs-shimmer').length).toBe(3);
  });

  it('shows an error and retry when the people read fails', () => {
    // WHY: a failed read is not an empty account. Retry reloads the same people read.
    const refetch = vi.fn();
    people.state = {
      data: undefined,
      isPending: false,
      isLoading: false,
      isError: true,
      isSuccess: false,
      refetch,
    };
    renderMap();

    const map = mapRegion();
    expect(within(map).queryByText(/No contacts yet/)).toBeNull();
    expect(within(map).queryByRole('link', { name: 'Add a contact' })).toBeNull();
    expect(within(map).queryByRole('img', { name: 'No contacts yet' })).toBeNull();
    expect(within(map).queryByText(/0 people/)).toBeNull();
    expect(within(map).queryByRole('button', { name: 'Table' })).toBeNull();
    expect(map.querySelector('.viz-figure')?.getAttribute('role')).toBeNull();
    expect(within(map).getByRole('alert')).toBeTruthy();
    expect(within(map).getByRole('heading', { name: "Couldn't load contacts" })).toBeTruthy();
    expect(within(map).getByText('Please try again.')).toBeTruthy();
    const retry = within(map).getByRole('button', { name: 'Retry' });
    expect(retry.className).toContain('min-h-11');
    expect(retry.className).toContain('focus-visible:ring-2');
    fireEvent.click(retry);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('shows the empty state only after a successful read with no people', () => {
    // WHY: empty is a real result. The add-a-contact path stays for that case only.
    people.state = settled([]);
    renderMap();

    const map = mapRegion();
    expect(within(map).getByText(/No contacts yet/)).toBeTruthy();
    expect(within(map).queryByRole('alert')).toBeNull();
    expect(map.querySelector('[aria-busy="true"]')).toBeNull();
  });
});

describe('relationship map reports-to cell', () => {
  it('opens the manager contact when the reports-to id is a uuid', () => {
    // WHY: the cell already stores the manager. The name is the label. A uuid
    // that is not in this list still opens that contact, and the id is not the label.
    people.state = settled([
      person(MGR, 'Mina West', null, 'Director'),
      person(ADA, 'Ada North', MGR),
      person('55555555-5555-4555-8555-555555555555', 'Lee South', ORPHAN, 'Analyst'),
    ]);
    renderMap();

    const map = mapRegion();
    fireEvent.click(within(map).getByRole('button', { name: 'Table' }));
    const named = within(map).getAllByRole('link', { name: 'Mina West' });
    expect(named.length).toBeGreaterThan(0);
    for (const link of named) {
      expect(link.getAttribute('href')).toBe(`/contacts/${MGR}`);
      expect(link.getAttribute('href')).not.toContain('Mina');
      expect(link.getAttribute('href')).not.toContain('search=');
    }
    const manager = within(map).getByRole('link', { name: 'View manager' });
    expect(manager.getAttribute('href')).toBe(`/contacts/${ORPHAN}`);
    expect(manager.getAttribute('href')).not.toContain('Lee');
    expect(manager.textContent).not.toContain(ORPHAN);
    expect(manager.className).toContain('min-h-11');
    expect(manager.className).toContain('text-[var(--brand-primary)]');
    expect(manager.className).toContain('dark:text-[var(--brand-deep)]');
    expect(manager.className).toContain('focus-visible:outline-2');
  });

  it('leaves a name, a script, and a blank manager as text', () => {
    // WHY: only a contact uuid may become a path. A stored script, a person's
    // name used as an id, or a blank id must not be a link.
    people.state = settled([
      person('javascript:alert(1)', 'Script Person'),
      person('Globex Labs', 'Globex Labs', 'javascript:alert(1)'),
      person('', 'Blank Person', 'Globex Labs'),
      person('66666666-6666-4666-8666-666666666666', 'Pat East', ' https://evil.example/phish'),
    ]);
    renderMap();

    const map = mapRegion();
    expect(within(map).getAllByText('Script Person').length).toBeGreaterThan(0);
    expect(within(map).getAllByText('Globex Labs').length).toBeGreaterThan(0);
    fireEvent.click(within(map).getByRole('button', { name: 'Table' }));
    expect(within(map).queryByRole('link')).toBeNull();
    expect(within(map).getByRole('rowheader', { name: 'Script Person' })).toBeTruthy();
    expect(within(map).getByRole('rowheader', { name: 'Globex Labs' })).toBeTruthy();
    expect(within(map).getByRole('rowheader', { name: 'Blank Person' })).toBeTruthy();
    expect(within(map).getAllByText('Script Person').length).toBeGreaterThan(0);
    expect(within(map).getAllByText('Globex Labs').length).toBeGreaterThan(0);
    expect(document.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(document.querySelector('a[href*="Globex"]')).toBeNull();
    expect(document.querySelector('a[href*="evil.example"]')).toBeNull();
    expect(document.querySelector('a[href*="search="]')).toBeNull();
  });
});

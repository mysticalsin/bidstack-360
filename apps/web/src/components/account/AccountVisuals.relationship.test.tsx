// The relationship map on an account cockpit draws the people filed on that
// company. Demo CI Financial includes Michael Johnson. The name is drawn as
// text, so opening him means leaving the account and searching Contacts.
// A search can match a different person. A read that has not settled is not
// "no contacts yet".
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const people = vi.hoisted(() => ({
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
  data: undefined as
    | {
        people: Array<{
          id: string;
          name: string;
          title: string | null;
          standing: string;
          reportsToContactId: string | null;
        }>;
      }
    | undefined,
}));

vi.mock('@/hooks/useOpportunityRows', () => ({
  useOpportunityRows: () => ({ data: { items: [] }, isLoading: false, isError: false }),
}));

vi.mock('@/hooks/useAccountPeople', () => ({
  usePeopleMap: () => people,
}));

import { AccountVisuals } from './AccountVisuals';

const MICHAEL = '11111111-1111-4111-8111-111111111111';
const CI = '22222222-2222-4222-8222-222222222222';

function renderMap() {
  render(
    <MemoryRouter>
      <AccountVisuals companyId={CI} companyName="CI Financial" />
    </MemoryRouter>,
  );
}

afterEach(() => {
  people.isLoading = false;
  people.isError = false;
  people.data = undefined;
  people.refetch.mockClear();
  cleanup();
});

describe('Account relationship map', () => {
  it('opens the contact record from a person on the map', () => {
    // WHY: Michael Johnson is already a contact on CI Financial. The map
    // draws his name and stops. The click has to open that id.
    people.data = {
      people: [
        {
          id: MICHAEL,
          name: 'Michael Johnson',
          title: 'Chief Information Officer',
          standing: 'evidenced',
          reportsToContactId: null,
        },
      ],
    };
    renderMap();

    const link = screen.getByRole('link', { name: 'Open Michael Johnson' });
    expect(link.getAttribute('href')).toBe(`/contacts/${MICHAEL}`);
    expect(link.getAttribute('href')).not.toContain('Michael');
    expect(link.getAttribute('href')).not.toContain('search=');
    expect(link.className).toContain('focus-visible:outline-2');
    const name = link.querySelector('.rel-name');
    expect(name?.className).toContain('underline');
    expect(link.querySelector('rect')?.getAttribute('height')).toBe('52');
    // The account itself is the root of the map, not a second contact.
    expect(screen.queryByRole('link', { name: /CI Financial/ })).toBeNull();
  });

  it('leaves a script id and a name-shaped id as text', () => {
    // WHY: only a contact uuid may become a path. A stored script, or the
    // person's name used as an id, must not be a link.
    people.data = {
      people: [
        {
          id: 'javascript:alert(1)',
          name: 'Script Person',
          title: null,
          standing: 'unknown',
          reportsToContactId: null,
        },
        {
          id: 'Globex Labs',
          name: 'Globex Labs',
          title: null,
          standing: 'unknown',
          reportsToContactId: null,
        },
      ],
    };
    renderMap();

    expect(screen.queryByRole('link', { name: /Script Person/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Globex Labs/ })).toBeNull();
    expect(screen.getByText('Script Person')).toBeTruthy();
    expect(screen.getByText('Globex Labs')).toBeTruthy();
    expect(document.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(document.querySelector('a[href*="search="]')).toBeNull();
  });

  it('does not call the map empty while the people read is still loading', () => {
    // WHY: an empty map and a loading map are different. "No contacts yet"
    // would send someone to add a person who is already on the account.
    people.isLoading = true;
    renderMap();

    expect(screen.queryByText(/No contacts yet/)).toBeNull();
    expect(screen.getByRole('status').textContent).toMatch(/Loading contacts/);
    expect(screen.queryByRole('link', { name: 'Add a contact' })).toBeNull();
  });

  it('says the people read failed instead of offering to add a contact', () => {
    // WHY: a failed read is not an empty account. Adding a contact would
    // duplicate people the map could not load.
    people.isError = true;
    renderMap();

    expect(screen.queryByText(/No contacts yet/)).toBeNull();
    expect(screen.getByRole('status').textContent).toMatch(/Couldn't load contacts/);
    fireEvent.click(screen.getByRole('button', { name: 'Retry contacts' }));
    expect(people.refetch).toHaveBeenCalledTimes(1);
  });

  it('keeps the empty map, with an underlined add link, once the read settles', () => {
    // WHY: a settled empty map is the only time "add a contact" is true.
    // The link sits in a sentence, so color alone is not enough to see it.
    people.data = { people: [] };
    renderMap();

    expect(screen.getByText(/No contacts yet/)).toBeTruthy();
    const add = screen.getByRole('link', { name: 'Add a contact' });
    expect(add.getAttribute('href')).toBe('/contacts');
    expect(add.className).toContain('underline');
    expect(add.className).toContain('focus-visible:outline-2');
    expect(add.className).toContain('dark:text-[var(--brand-deep)]');
  });
});

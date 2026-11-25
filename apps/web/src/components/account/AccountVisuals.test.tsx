// A person on the account cockpit relationship map is a contact. The node and
// the table row open that contact. A name, a script, or a blank is not an address.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const people = vi.hoisted(() => ({
  list: [] as Array<{
    id: string;
    name: string;
    title: string | null;
    standing: string;
    reportsToContactId: string | null;
  }>,
}));

vi.mock('@/hooks/useAccountPeople', () => ({
  usePeopleMap: () => ({ data: { people: people.list } }),
}));

vi.mock('@/hooks/useOpportunityRows', () => ({
  useOpportunityRows: () => ({ data: { items: [] } }),
}));

import { AccountVisuals } from './AccountVisuals';

const ADA = '11111111-1111-4111-8111-111111111111';
const COMPANY = '22222222-2222-4222-8222-222222222222';

function person(
  id: string,
  name: string,
  title: string | null = 'Buyer',
): (typeof people.list)[number] {
  return { id, name, title, standing: 'evidenced', reportsToContactId: null };
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
  people.list = [];
  cleanup();
});

describe('account relationship map contact', () => {
  it('opens the contact from the map node when the person id is a uuid', () => {
    // WHY: the cockpit already has the contact id. Leaving the map to search
    // by name can open a different person. The node goes to that id.
    people.list = [person(ADA, 'Ada North', 'Buyer')];
    renderMap();

    const map = mapRegion();
    const link = within(map).getByRole('link', { name: 'Ada North' });
    expect(link.getAttribute('href')).toBe(`/contacts/${ADA}`);
    expect(link.getAttribute('href')).not.toContain('Ada');
    expect(link.getAttribute('href')).not.toContain('search=');
    expect(link.className).toContain('text-[var(--brand-primary)]');
    expect(link.className).toContain('dark:text-[var(--brand-deep)]');
    expect(link.className).toContain('focus-visible:outline-2');
    const box = link.querySelector('rect');
    expect(Number(box?.getAttribute('width'))).toBeGreaterThanOrEqual(44);
    expect(Number(box?.getAttribute('height'))).toBeGreaterThanOrEqual(44);
    // A link inside role="img" is hidden from the accessibility tree.
    expect(map.querySelector('.viz-figure')?.getAttribute('role')).toBeNull();
    expect(within(map).queryByRole('link', { name: 'Northwind' })).toBeNull();
  });

  it('opens the same contact from the table row', () => {
    // WHY: the table is the text alternative of the map. A person who can be
    // opened from the node can be opened from the row, through the same id.
    people.list = [person(ADA, 'Ada North', 'Buyer')];
    renderMap();

    const map = mapRegion();
    fireEvent.click(within(map).getByRole('button', { name: 'Table' }));
    const link = within(map).getByRole('link', { name: 'Ada North' });
    expect(link.getAttribute('href')).toBe(`/contacts/${ADA}`);
    expect(link.getAttribute('href')).not.toContain('Ada');
    expect(link.className).toContain('min-h-11');
    expect(link.className).toContain('focus-visible:outline-2');
    expect(link.className).toContain('text-[var(--brand-primary)]');
    expect(link.className).toContain('dark:text-[var(--brand-deep)]');
  });

  it('leaves a name, a script, and a blank as text', () => {
    // WHY: only a contact uuid may become a path. A stored script, the
    // person's name used as an id, or a blank id must not be a link.
    people.list = [
      person('javascript:alert(1)', 'Script Person'),
      person('Globex Labs', 'Globex Labs'),
      person('', 'Blank Person'),
    ];
    renderMap();

    expect(screen.queryByRole('link', { name: 'Script Person' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Globex Labs' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Blank Person' })).toBeNull();
    expect(screen.getAllByText('Script Person').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Globex Labs').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Blank Person').length).toBeGreaterThan(0);
    expect(document.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(document.querySelector('a[href*="Globex"]')).toBeNull();
    expect(document.querySelector('a[href*="search="]')).toBeNull();
  });
});

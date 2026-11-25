// Key contacts are the buying group on the account cockpit. Demo people such
// as Michael Johnson on CI Financial are stored with a contact id. The name
// has to open that record. An id that is not a contact id has no page and
// stays text.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import '@/i18n';
import type { AccountCockpitSnapshot, CrmPerson } from '@bidstack/shared';

import { KeyContactsCard } from './KeyContactsCard';

const MICHAEL = '00000000-0000-4000-8000-000000000001';

function person(id: string, name: string): CrmPerson {
  return {
    id,
    source: 'external_crm',
    companyId: 'c0000000-0000-4000-8000-000000000001',
    name,
    title: 'Chief Information Officer',
    email: 'mjohnson@ci.com',
    phone: null,
    influence: 5,
    roleInDecision: 'champion',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function renderCard(contacts: CrmPerson[]) {
  render(
    <MemoryRouter>
      <KeyContactsCard cockpit={{ keyContacts: contacts } as AccountCockpitSnapshot} />
    </MemoryRouter>,
  );
}

describe('KeyContactsCard', () => {
  afterEach(cleanup);

  it('opens the contact record from a key contact name', () => {
    // WHY: the cockpit lists Michael Johnson as plain text. Opening the person
    // means leaving the account and searching Contacts, which can match someone else.
    renderCard([person(MICHAEL, 'Michael Johnson')]);

    const link = screen.getByRole('link', { name: /Michael Johnson/ });
    expect(link.getAttribute('href')).toBe(`/contacts/${MICHAEL}`);
    expect(link.textContent).toContain('open contact');
    expect(link.className).toContain('min-h-11');
    expect(link.className).toContain('focus-visible:ring-2');
    expect(link.className).toContain('dark:text-[var(--brand-deep)]');
  });

  it('keeps a row as text when the id is not a contact id', () => {
    // WHY: the address is the id, never the name. A script, a path, or a
    // short fixture id must not become the href.
    renderCard([person('p2', 'Pat Example')]);

    expect(screen.getByText('Pat Example')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });
});

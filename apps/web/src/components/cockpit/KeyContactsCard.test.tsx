import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import '@/i18n';
import type { AccountCockpitSnapshot, CrmPerson } from '@bidstack/shared';

import { KeyContactsCard } from './KeyContactsCard';

const KLAUS = '11111111-1111-4111-8111-111111111111';

function person(overrides: Partial<CrmPerson> & Pick<CrmPerson, 'id' | 'name'>): CrmPerson {
  return {
    source: 'external_crm',
    companyId: '22222222-2222-4222-8222-222222222222',
    title: 'VP Operations',
    email: 'klaus.vogt@example.com',
    phone: null,
    influence: 5,
    roleInDecision: 'champion',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderCard(contacts: CrmPerson[]) {
  const cockpit = { keyContacts: contacts } as AccountCockpitSnapshot;
  return render(
    <MemoryRouter>
      <KeyContactsCard cockpit={cockpit} />
    </MemoryRouter>,
  );
}

afterEach(cleanup);

describe('KeyContactsCard', () => {
  it('opens the contact record for the person on the account', () => {
    // WHY: the Siemens cockpit names Klaus Vogt, VP Operations, champion.
    // A salesperson has to leave the account and search Contacts to reach him.
    // The id is the contact row, so the name is the way in.
    renderCard([person({ id: KLAUS, name: 'Klaus Vogt' })]);

    const link = screen.getByRole('link', { name: /Klaus Vogt/ });
    expect(link.getAttribute('href')).toBe(`/contacts/${KLAUS}`);
    expect(link.textContent).toContain('VP Operations');
    expect(link.textContent).toContain('champion');
    // The name stays the label. It is not written into the address.
    expect(link.getAttribute('href')).not.toContain('Klaus');
  });

  it('does not turn a script, a path, or a foreign address into a link', () => {
    // WHY: the id is the only thing that may become a path. A stored name or a
    // bad id must stay text, or the row can navigate off the app.
    renderCard([
      person({ id: 'javascript:alert(1)', name: 'Script Name' }),
      person({ id: '../admin', name: 'Path Name' }),
      person({ id: 'https://evil.example/phish', name: 'Url Name' }),
      person({ id: '', name: 'Blank Name' }),
    ]);

    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Script Name')).toBeTruthy();
    expect(screen.getByText('Path Name')).toBeTruthy();
    expect(screen.getByText('Url Name')).toBeTruthy();
    expect(screen.getByText('Blank Name')).toBeTruthy();
  });
});

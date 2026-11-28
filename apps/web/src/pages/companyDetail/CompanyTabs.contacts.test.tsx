// Opening Siemens lands on the Contacts tab. Klaus Vogt's row prints
// klaus.vogt.demo@example.com and +49 30 1234 5670 as plain text, so the
// roster that lists the person cannot mail or call him. The name already
// opens the record. The address and the phone have to be those actions.
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ContactTab } from './CompanyTabs';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback: string) => fallback ?? key,
  }),
}));

const KLAUS = '00000000-0000-4000-8000-000000000021';

function renderRoster(
  contacts: Array<{
    id: string;
    name: string;
    role: string | null;
    email: string | null;
    phone: string | null;
  }>,
) {
  return render(
    <MemoryRouter>
      <ContactTab contacts={contacts} />
    </MemoryRouter>,
  );
}

function expectsAction(link: HTMLElement) {
  expect(link.className).toContain('min-h-11');
  expect(link.className).toContain('dark:text-[var(--brand-deep)]');
  expect(link.className).toContain('focus-visible:ring-2');
  expect(link.className).toContain('dark:focus-visible:ring-[var(--brand-deep)]');
}

afterEach(() => {
  cleanup();
});

describe('account contacts roster', () => {
  it('mails and calls Klaus Vogt from the numbers printed on the row', () => {
    // WHY: the demo phone is spaced. A row that only shows the text makes
    // the person listed on the account impossible to reach from that list.
    renderRoster([
      {
        id: KLAUS,
        name: 'Klaus Vogt',
        role: 'VP Operations',
        email: 'klaus.vogt.demo@example.com',
        phone: '+49 30 1234 5670',
      },
    ]);

    const mail = screen.getByRole('link', { name: 'klaus.vogt.demo@example.com' });
    expect(mail.getAttribute('href')).toBe('mailto:klaus.vogt.demo@example.com');
    expectsAction(mail);

    const call = screen.getByRole('link', { name: '+49 30 1234 5670' });
    expect(call.getAttribute('href')).toBe('tel:+493012345670');
    expectsAction(call);

    expect(screen.getByRole('link', { name: 'Klaus Vogt' }).getAttribute('href')).toBe(
      `/contacts/${KLAUS}`,
    );
  });

  it('does not invent a mail or call when the row has neither', () => {
    // WHY: a missing address is not a control. A fragment such as "12" is
    // not the demo phone and must stay text.
    renderRoster([
      {
        id: KLAUS,
        name: 'Klaus Vogt',
        role: null,
        email: null,
        phone: '12',
      },
    ]);

    expect(screen.queryByRole('link', { name: /mailto|tel:|@/ })).toBeNull();
    expect(screen.getByRole('link', { name: 'Klaus Vogt' }).getAttribute('href')).toBe(
      `/contacts/${KLAUS}`,
    );
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.getByText('12').closest('a')).toBeNull();
  });
});

// Space on the contacts list peeks the person without leaving the table.
// Michael Johnson's name is plain text, so the peek cannot open the record
// — the user has to close it and click the row. The phone +1 416 555 0142
// is plain text, and the demo book stores phones with spaces, so the printed
// string is not a call. The email link uses the fill green as text in dark
// mode, and the hit area is the line box.
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Contact } from '@bidstack/shared';

import { ContactQuickLook } from './ContactQuickLook';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback: string) => fallback ?? key,
  }),
}));

const MICHAEL = '00000000-0000-4000-8000-000000000001';

function contact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: MICHAEL,
    customer: 'CI Financial',
    name: 'Michael Johnson',
    role: 'Chief Information Officer',
    email: 'mjohnson@ci.com',
    phone: '+1 416 555 0142',
    influence: 5,
    sentiment: 'warm',
    createdAt: '2026-05-01T00:00:00.000Z',
    companyId: 'c0000000-0000-4000-8000-000000000001',
    linkState: 'linked',
    ...overrides,
  };
}

function renderPeek(row: Contact | null) {
  return render(
    <MemoryRouter>
      <ContactQuickLook contact={row} onClose={vi.fn()} />
    </MemoryRouter>,
  );
}

function expectsReadableTarget(link: HTMLElement) {
  expect(link.className).toContain('dark:text-[var(--brand-deep)]');
  expect(link.className).toContain('min-h-[44px]');
  expect(link.className).toContain('focus-visible:ring-2');
  expect(link.className).toContain('dark:focus-visible:ring-[var(--brand-deep)]');
}

afterEach(() => {
  cleanup();
});

describe('contact quick look', () => {
  it('opens Michael Johnson and calls the spaced phone the card prints', () => {
    // WHY: the peek is how the list reaches this person. The name has to
    // open the record, and +1 416 555 0142 has to dial. The fill green is
    // not the dark-mode text color, and a line-height link is under 44px.
    renderPeek(contact());

    const name = screen.getByRole('link', { name: 'Michael Johnson' });
    expect(name.getAttribute('href')).toBe(`/contacts/${MICHAEL}`);
    expectsReadableTarget(name);

    const mail = screen.getByRole('link', { name: 'mjohnson@ci.com' });
    expect(mail.getAttribute('href')).toBe('mailto:mjohnson@ci.com');
    expectsReadableTarget(mail);

    const call = screen.getByRole('link', { name: '+1 416 555 0142' });
    expect(call.getAttribute('href')).toBe('tel:+14165550142');
    expectsReadableTarget(call);

    expect(screen.getByText('CI Financial').closest('a')).toBeNull();
  });

  it('does not invent a record, a mail, or a call', () => {
    // WHY: a missing address is not a control. "12" is not the demo phone.
    // A name that is not a contact id must not become a route.
    renderPeek(
      contact({
        id: 'not-a-contact',
        email: null,
        phone: '12',
        role: null,
        influence: null,
        sentiment: null,
      }),
    );

    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Michael Johnson')).toBeTruthy();
    expect(screen.getByText('12').closest('a')).toBeNull();
  });

  it('renders nothing when the peek is closed', () => {
    // WHY: a closed peek must not leave the person's links in the page.
    renderPeek(null);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByText('Michael Johnson')).toBeNull();
  });
});

// A linked contact on a deal is a person with a record. The name has to open
// that record. A customer-name search, or a script stored in the id, must not
// become the address.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) => {
      if (!values) return fallback;
      return fallback.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(values[k] ?? ''));
    },
  }),
}));

const panel = vi.hoisted(() => ({
  isLoading: false,
  isError: false,
  items: [] as Array<{
    id: string;
    contactId: string;
    role: string;
    isPrimary: boolean;
    contact: { id: string; name: string; email: string | null };
  }>,
}));

vi.mock('@/hooks/useOpportunityContacts', () => ({
  useOpportunityContacts: () => ({
    isLoading: panel.isLoading,
    isError: panel.isError,
    data: panel.isLoading ? undefined : { items: panel.items, contactsContinue: false },
    refetch: vi.fn(),
  }),
  useLinkContact: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUnlinkContact: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateContactRole: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/hooks/useContacts', () => ({
  useContacts: () => ({ data: { items: [] }, isLoading: false }),
}));

import { ContactsPanel } from './ContactsPanel';

const ADA = '11111111-1111-4111-8111-111111111111';

function renderPanel() {
  render(
    <MemoryRouter>
      <ContactsPanel oppId="22222222-2222-4222-8222-222222222222" />
    </MemoryRouter>,
  );
}

afterEach(() => {
  panel.isLoading = false;
  panel.isError = false;
  panel.items = [];
  cleanup();
});

describe('ContactsPanel contact record', () => {
  it('opens the contact record from the linked name and keeps the name out of the address', () => {
    // WHY: the deal already stores the contact id. Searching contacts by the
    // displayed name can open a different person. The click goes to that id.
    panel.items = [
      {
        id: '33333333-3333-4333-8333-333333333333',
        contactId: ADA,
        role: 'champion',
        isPrimary: true,
        contact: { id: ADA, name: 'Ada North', email: 'ada@northwind.example' },
      },
    ];
    renderPanel();

    const link = screen.getByRole('link', { name: /Ada North/ });
    expect(link.getAttribute('href')).toBe(`/contacts/${ADA}`);
    expect(link.getAttribute('href')).not.toContain('Ada');
    expect(link.getAttribute('href')).not.toContain('search=');
    expect(link.className).toContain('min-h-11');
    expect(link.className).toContain('focus-visible:ring-2');
    expect(link.className).toContain('text-[var(--brand-primary)]');
    expect(link.className).toContain('dark:text-[var(--brand-deep)]');
    // The role control sits on the same row. It needs a name or the link is
    // the only thing a screen reader can identify.
    expect(screen.getByRole('combobox', { name: 'Role for Ada North' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Unset primary' })).toBeTruthy();
  });

  it('leaves a script id and a name-shaped id as text', () => {
    // WHY: only a contact uuid may become a path. A stored script, or the
    // person's name used as an id, must not be a link.
    panel.items = [
      {
        id: '44444444-4444-4444-8444-444444444444',
        contactId: 'javascript:alert(1)',
        role: 'stakeholder',
        isPrimary: false,
        contact: { id: 'javascript:alert(1)', name: 'Script Person', email: null },
      },
      {
        id: '55555555-5555-4555-8555-555555555555',
        contactId: 'Globex Labs',
        role: 'influencer',
        isPrimary: false,
        contact: { id: 'Globex Labs', name: 'Globex Labs', email: null },
      },
    ];
    renderPanel();

    expect(screen.queryByRole('link', { name: /Script Person/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Globex Labs/ })).toBeNull();
    expect(screen.getByText('Script Person')).toBeTruthy();
    expect(screen.getByText('Globex Labs')).toBeTruthy();
    expect(document.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(document.querySelector('a[href*="search="]')).toBeNull();
  });

  it('does not offer a contact while the deal contacts are still loading', () => {
    // WHY: an empty list and a loading list are different. A name must not
    // appear, and then vanish, before the read settles.
    panel.isLoading = true;
    panel.items = [
      {
        id: '33333333-3333-4333-8333-333333333333',
        contactId: ADA,
        role: 'champion',
        isPrimary: false,
        contact: { id: ADA, name: 'Ada North', email: null },
      },
    ];
    renderPanel();

    expect(screen.queryByRole('link', { name: /Ada North/ })).toBeNull();
    expect(screen.queryByText('Ada North')).toBeNull();
  });
});

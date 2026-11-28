// A contact record already stores the company id. The company name still
// opens a companies search on that name. Demo rows such as Klaus Vogt at
// Siemens are linked, but a name search can land on a different company
// (Globex versus Globex Labs) and adds a click before the account.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const SIEMENS = 'c0000000-0000-4000-8000-0000000000aa';

const contact = vi.hoisted(() => ({
  data: {
    id: '00000000-0000-4000-8000-000000000010',
    customer: 'Siemens',
    name: 'Klaus Vogt',
    role: 'VP Operations',
    email: 'klaus.vogt@example.test',
    phone: null as string | null,
    influence: 5,
    sentiment: 'hot' as const,
    createdAt: '2026-05-01T00:00:00.000Z',
    companyId: 'c0000000-0000-4000-8000-0000000000aa' as string | null,
    linkState: 'linked' as 'linked' | 'needs_review',
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback: string, values?: Record<string, unknown>) => {
      const text = fallback ?? key;
      if (!values) return text;
      return text.replace(/\{\{(\w+)\}\}/g, (_match, token: string) => String(values[token] ?? ''));
    },
  }),
}));

vi.mock('@/hooks/useContacts', () => ({
  useContact: () => ({
    isLoading: false,
    isError: false,
    data: contact.data,
  }),
}));

vi.mock('@/hooks/useOpportunities', () => ({
  useOpportunities: () => ({ data: { items: [], nextCursor: null } }),
}));

vi.mock('@/hooks/useTasks', () => ({ useTasks: () => ({ data: { items: [] } }) }));
vi.mock('@/hooks/useNotes', () => ({ useNotes: () => ({ data: { items: [] } }) }));
vi.mock('@/components/CustomFieldValuesSection', () => ({ CustomFieldValuesSection: () => null }));
vi.mock('@/components/email/EmailPanel', () => ({ EmailPanel: () => null }));
vi.mock('@/components/editor/CollaborativeNotesSection', () => ({
  CollaborativeNotesSection: () => null,
}));
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useParams: () => ({ id: '00000000-0000-4000-8000-000000000010' }) };
});

import { ContactDetailPage } from './ContactDetailPage';

function renderRecord() {
  render(
    <MemoryRouter>
      <ContactDetailPage />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  contact.data = {
    id: '00000000-0000-4000-8000-000000000010',
    customer: 'Siemens',
    name: 'Klaus Vogt',
    role: 'VP Operations',
    email: 'klaus.vogt@example.test',
    phone: null,
    influence: 5,
    sentiment: 'hot',
    createdAt: '2026-05-01T00:00:00.000Z',
    companyId: SIEMENS,
    linkState: 'linked',
  };
});

describe('contact record company name', () => {
  it('opens the account the contact already stores', () => {
    // WHY: the header is the company on this person. The id is the account.
    // A name search is a second page and can match a different company.
    renderRecord();

    const account = screen.getByRole('link', { name: 'Open account Siemens' });
    expect(account.getAttribute('href')).toBe(`/accounts/${SIEMENS}`);
    expect(account.className).toContain('min-h-11');
    expect(account.className).toContain('focus-visible:ring-2');
    expect(account.className).toContain('dark:text-[var(--brand-deep)]');
    expect(document.querySelector('a[href*="companies?search"]')).toBeNull();
  });

  it('leaves an unlinked customer as text', () => {
    // WHY: needs_review means there is no safe unique company. Searching the
    // name would still open the wrong list.
    contact.data = {
      ...contact.data,
      customer: 'Globex',
      companyId: null,
      linkState: 'needs_review',
    };

    renderRecord();

    expect(screen.queryByRole('link', { name: /Globex/ })).toBeNull();
    const header = document.querySelector('p.mt-1');
    expect(header?.textContent).toContain('Globex');
    expect(header?.querySelector('a')).toBeNull();
    expect(document.querySelector('a[href*="companies?search"]')).toBeNull();
  });
});

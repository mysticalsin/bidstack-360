import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { ContactDetailPage } from './ContactDetailPage';
import { useOpportunities } from '@/hooks/useOpportunities';

const contactState = vi.hoisted(() => ({
  companyId: null as string | null,
}));

vi.mock('@/hooks/useContacts', () => ({
  useContact: vi.fn(() => ({
    isLoading: false,
    isError: false,
    data: {
      id: 'c-1',
      customer: 'Globex',
      name: 'Hank Scorpio',
      role: 'CEO',
      email: null,
      phone: null,
      influence: null,
      sentiment: null,
      createdAt: new Date().toISOString(),
      companyId: contactState.companyId,
      linkState: contactState.companyId ? 'linked' : 'needs_review',
    },
  })),
}));
vi.mock('@/hooks/useOpportunities', () => ({
  useOpportunities: vi.fn(() => ({
    data: {
      items: [
        { id: 'o-1', code: 'OP-1', name: 'Globex deal', customer: 'Globex', stage: 'qualify', probability: 20 },
        { id: 'o-2', code: 'OP-2', name: 'Globex Labs deal', customer: 'Globex Labs', stage: 'qualify', probability: 20 },
      ],
      nextCursor: null,
    },
  })),
}));
vi.mock('@/hooks/useTasks', () => ({ useTasks: vi.fn(() => ({ data: { items: [] } })) }));
vi.mock('@/hooks/useNotes', () => ({ useNotes: vi.fn(() => ({ data: { items: [] } })) }));
vi.mock('@/components/CustomFieldValuesSection', () => ({ CustomFieldValuesSection: () => null }));
vi.mock('@/components/email/EmailPanel', () => ({ EmailPanel: () => null }));
vi.mock('@/components/email/EmailPanel', () => ({ EmailPanel: () => null }));
vi.mock('@/components/editor/CollaborativeNotesSection', () => ({
  CollaborativeNotesSection: () => null,
}));
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useParams: () => ({ id: 'c-1' }) };
});

describe('ContactDetailPage related opportunities', () => {
  afterEach(() => {
    contactState.companyId = null;
    cleanup();
  });

  it('asks the server for this customer instead of filtering the first page of all deals', () => {
    render(
      <MemoryRouter>
        <ContactDetailPage />
      </MemoryRouter>,
    );
    const filters = vi.mocked(useOpportunities).mock.calls.map((c) => c[0]);
    expect(filters.some((f) => f?.search === 'Globex')).toBe(true);
    expect(screen.getByText('OP-1')).toBeTruthy();
    expect(screen.queryByText('OP-2')).toBeNull();
  });
});

const LINKED = '22222222-2222-4222-8222-222222222222';

describe('ContactDetailPage customer account', () => {
  afterEach(() => {
    contactState.companyId = null;
    cleanup();
  });

  function renderContact() {
    render(
      <MemoryRouter>
        <ContactDetailPage />
      </MemoryRouter>,
    );
  }

  it('does not search companies by a customer name that can match another account', () => {
    // WHY: the word Globex used to open /companies?search=Globex. That search
    // is a contains match on name, domain, and industry, so Globex Labs can
    // sit in the results. An unlinked contact has no company to open.
    renderContact();

    expect(screen.getByText('Globex')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Globex/ })).toBeNull();
    expect(document.querySelector('a[href*="search="]')).toBeNull();
  });

  it('opens the account cockpit for the company this contact is linked to', () => {
    // WHY: the contact already stores the company id. The customer word should
    // open that account, and the name must not become the address.
    contactState.companyId = LINKED;
    renderContact();

    const link = screen.getByRole('link', { name: /Globex/ });
    expect(link.getAttribute('href')).toBe(`/accounts/${LINKED}`);
    expect(link.getAttribute('href')).not.toContain('Globex');
    expect(link.getAttribute('href')).not.toContain('search=');
  });

  it('does not turn a script id into the customer link', () => {
    // WHY: only a company id may become a path. A stored script stays text.
    contactState.companyId = 'javascript:alert(1)';
    renderContact();

    expect(screen.queryByRole('link', { name: /Globex/ })).toBeNull();
    expect(document.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(screen.getByText('Globex')).toBeTruthy();
  });
});

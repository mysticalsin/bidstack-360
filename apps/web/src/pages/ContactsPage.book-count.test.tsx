// The contacts pager counts the rows it has. Before the list settles, that
// number is zero. On the demo book that zero is a lie: Klaus Vogt is still
// there, and a failed read is not an empty buying group. A workspace that
// has actually settled empty is the first-run book, and it may say zero.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ContactsPage } from './ContactsPage';
import { useContacts } from '@/hooks/useContacts';
import type { Contact } from '@bidstack/shared';

vi.mock('@/hooks/useContacts', () => ({
  useContacts: vi.fn(),
  useCreateContact: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
  useDeleteContact: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
  useUpdateContact: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
}));

vi.mock('@/hooks/useCapabilities', () => ({ useHasPermission: vi.fn(() => true) }));

const KLAUS_PHONE = '+49 30 1234 5670';

function klaus(): Contact {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    customer: 'Siemens',
    name: 'Klaus Vogt',
    role: 'VP Operations',
    email: 'klaus.vogt.demo@example.com',
    phone: KLAUS_PHONE,
    influence: 5,
    sentiment: 'hot',
    createdAt: '2026-05-01T00:00:00.000Z',
    companyId: '22222222-2222-4222-8222-222222222222',
    linkState: 'linked',
  };
}

function mockContacts(value: Partial<ReturnType<typeof useContacts>>) {
  vi.mocked(useContacts).mockReturnValue(value as ReturnType<typeof useContacts>);
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ContactsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('contacts book count', () => {
  it('does not count a loading demo book as zero people', () => {
    // WHY: the first paint has no payload yet. "Page 1 · 0 contacts" reads as
    // an empty buying group while Klaus Vogt's row is still on the way.
    mockContacts({
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.queryByText(/0 contacts/)).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Nobody in the buying group yet' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Klaus Vogt' })).toBeNull();
  });

  it('does not call an unsettled read an empty buying group', () => {
    // WHY: a paused query is pending without isLoading. The rows are not a
    // settled empty book, so the page must not invite a first contact.
    mockContacts({
      data: undefined,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.queryByText(/0 contacts/)).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Nobody in the buying group yet' })).toBeNull();
    expect(screen.queryByRole('link', { name: /import contacts from CSV/i })).toBeNull();
  });

  it('does not count a failed demo read as zero people', () => {
    // WHY: the list failed. Klaus Vogt may still be in the book. Zero would
    // say the workspace has no contacts, and the error already says to retry.
    mockContacts({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('offline'),
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByRole('heading', { name: 'Could not load contacts' })).toBeTruthy();
    expect(screen.queryByText(/0 contacts/)).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Nobody in the buying group yet' })).toBeNull();
  });

  it('counts Klaus Vogt once the demo book has settled', () => {
    // WHY: a settled payload is the book. The count has to name that page,
    // and the empty headline stays reserved for a settled empty list.
    mockContacts({
      data: { items: [klaus()], nextCursor: null },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByRole('link', { name: 'Klaus Vogt' })).toBeTruthy();
    expect(screen.getByText(/Page 1 · 1 contacts/)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Nobody in the buying group yet' })).toBeNull();
  });

  it('says zero only after the book has settled empty', () => {
    // WHY: a workspace with no contacts is the first-run buying group. Hiding
    // that zero would make a real empty book look like a load that never ended.
    mockContacts({
      data: { items: [], nextCursor: null },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByRole('heading', { name: 'Nobody in the buying group yet' })).toBeTruthy();
    expect(screen.getByText(/Page 1 · 0 contacts/)).toBeTruthy();
  });
});

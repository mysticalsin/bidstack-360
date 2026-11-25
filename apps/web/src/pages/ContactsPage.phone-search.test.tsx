// The contacts list prints Klaus Vogt's phone as +49 30 1234 5670. Searching
// that string used to ask the server to match name, customer, and role, so
// the page said nothing matched even though the number is on the row.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
const LENA_PHONE = '+49 30 1234 5671';

function person(overrides: Partial<Contact>): Contact {
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
    ...overrides,
  };
}

const klaus = person({});
const lena = person({
  id: '33333333-3333-4333-8333-333333333333',
  name: 'Lena Fischer',
  role: 'IT Director',
  email: 'lena.fischer.demo@example.com',
  phone: LENA_PHONE,
  influence: 4,
  sentiment: 'warm',
});

function mockBook(book: Contact[]) {
  const cache = new Map<string, ReturnType<typeof useContacts>>();
  vi.mocked(useContacts).mockImplementation((params) => {
    // The list route cannot substring-match an encrypted phone. A phone
    // string sent as `search` comes back empty. A name search is unchanged.
    // The page object stays stable per query so a new array each render
    // does not reset the keyboard cursor forever.
    const key = params?.search ?? '';
    const hit = cache.get(key);
    if (hit) return hit;
    const items = params?.search ? [] : book;
    const next = {
      data: { items, nextCursor: null },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    } as ReturnType<typeof useContacts>;
    cache.set(key, next);
    return next;
  });
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

function typeSearch(value: string) {
  fireEvent.change(screen.getByRole('searchbox', { name: /search contacts/i }), {
    target: { value },
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('contacts list phone search', () => {
  it('finds Klaus Vogt when the search is the phone the row prints', () => {
    // WHY: the demo book shows +49 30 1234 5670 under Klaus. Sending that
    // string to name/customer/role search returns nobody, so the page said
    // the number was not in the book.
    mockBook([klaus, lena]);
    renderPage();

    typeSearch(KLAUS_PHONE);

    expect(screen.getByRole('link', { name: 'Klaus Vogt' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Lena Fischer' })).toBeNull();
    expect(screen.queryByText(/Nobody in the buying group yet/i)).toBeNull();

    const last = vi.mocked(useContacts).mock.calls.at(-1)?.[0];
    expect(last?.search).toBeUndefined();
  });

  it('does not call an empty phone search an empty buying group', () => {
    // WHY: a number that is not on the loaded page is "no matches". It is
    // not a book with no people. The demo book is still there.
    mockBook([lena]);
    renderPage();

    typeSearch(KLAUS_PHONE);

    expect(screen.queryByRole('link', { name: 'Lena Fischer' })).toBeNull();
    expect(screen.queryByText(/Nobody in the buying group yet/i)).toBeNull();
    expect(screen.getByText('No matches')).toBeTruthy();
  });

  it('still sends a customer name to the server', () => {
    // WHY: "Siemens" is not a phone. The server name search has to keep it.
    mockBook([klaus, lena]);
    renderPage();

    typeSearch('Siemens');

    const last = vi.mocked(useContacts).mock.calls.at(-1)?.[0];
    expect(last?.search).toBe('Siemens');
  });
});

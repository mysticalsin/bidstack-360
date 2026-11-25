// Space peeks one person. A later list (search, sort, or a refresh) must not
// keep that person's title and phone on the card, and it must not move the
// highlight onto someone else.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ContactsPage } from './ContactsPage';
import { useContacts } from '@/hooks/useContacts';
import { useHasPermission } from '@/hooks/useCapabilities';
import type { Contact } from '@bidstack/shared';

vi.mock('@/hooks/useContacts', () => ({
  useContacts: vi.fn(),
  useCreateContact: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
  useDeleteContact: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
  useUpdateContact: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
}));

vi.mock('@/hooks/useCapabilities', () => ({ useHasPermission: vi.fn() }));

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

const KLAUS = '00000000-0000-4000-8000-000000000021';
const LENA = '00000000-0000-4000-8000-000000000022';
const ERIK = '00000000-0000-4000-8000-000000000023';

function person(overrides: Partial<Contact> & Pick<Contact, 'id' | 'name' | 'customer'>): Contact {
  return {
    role: null,
    email: null,
    phone: null,
    influence: 4,
    sentiment: 'warm',
    createdAt: '2026-05-01T00:00:00.000Z',
    companyId: 'c0000000-0000-4000-8000-000000000010',
    linkState: 'linked',
    ...overrides,
  };
}

const klaus = person({
  id: KLAUS,
  customer: 'Siemens',
  name: 'Klaus Vogt',
  role: 'VP Operations',
  email: 'klaus.vogt.demo@example.com',
  phone: '+49 30 1234 5670',
  influence: 5,
  sentiment: 'hot',
});

const lena = person({
  id: LENA,
  customer: 'Siemens',
  name: 'Lena Fischer',
  role: 'IT Director',
  email: 'lena.fischer.demo@example.com',
  phone: '+49 30 1234 5671',
});

const erik = person({
  id: ERIK,
  customer: 'IKEA',
  name: 'Erik Lindqvist',
  role: 'CFO',
  email: 'erik.lindqvist.demo@example.com',
  phone: '+46 8 555 0102',
});

function mockContacts(items: Contact[], isLoading = false) {
  vi.mocked(useContacts).mockReturnValue({
    data: isLoading ? undefined : { items, nextCursor: null },
    isLoading,
    isError: false,
    error: null,
    refetch: vi.fn(),
  } as ReturnType<typeof useContacts>);
}

function tree() {
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ContactsPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function rowFor(name: string): HTMLElement {
  const row = screen
    .getAllByText(name)
    .map((el) => el.closest('tr'))
    .find((el): el is HTMLTableRowElement => el !== null);
  if (!row) throw new Error(`no row for ${name}`);
  return row;
}

describe('contacts peek follows the visible list', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useHasPermission).mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
  });

  it('closes Klaus Vogt when the loaded page no longer includes him', () => {
    // WHY: a search or a later page can drop the peeked person. Leaving
    // "VP Operations" and +49 30 1234 5670 up shows a phone the list is
    // not offering.
    mockContacts([klaus, lena]);
    const { rerender } = render(tree());

    fireEvent.keyDown(window, { key: 'j' });
    fireEvent.keyDown(window, { key: ' ' });

    const open = screen.getByRole('dialog');
    expect(within(open).getByText('Klaus Vogt')).toBeTruthy();
    expect(within(open).getByText('+49 30 1234 5670')).toBeTruthy();
    expect(within(open).getByText('VP Operations')).toBeTruthy();

    mockContacts([lena]);
    rerender(tree());

    // The close animation may still be leaving the tree. The card must not
    // stay open on Klaus, and the table must not still be offering him.
    const lingering = screen.queryByRole('dialog');
    if (lingering) expect(lingering.getAttribute('data-state')).toBe('closed');
    const table = document.querySelector('table');
    expect(table?.textContent ?? '').not.toContain('Klaus Vogt');
    expect(table?.textContent ?? '').not.toContain('+49 30 1234 5670');
    expect(table?.textContent ?? '').not.toContain('VP Operations');
    expect(screen.getByText('Lena Fischer')).toBeTruthy();
    expect(rowFor('Lena Fischer').getAttribute('data-cursor')).toBeNull();
  });

  it('refreshes the open card when Klaus Vogt is still listed', () => {
    // WHY: a refresh can replace the snapshot. The card has to show the
    // phone now on the row, and a blank title must not keep "VP Operations".
    // The highlight stays on him after the rows reorder, so the next move
    // is not Erik Lindqvist.
    mockContacts([klaus, lena, erik]);
    const { rerender } = render(tree());

    fireEvent.keyDown(window, { key: 'j' });
    fireEvent.keyDown(window, { key: ' ' });
    expect(within(screen.getByRole('dialog')).getByText('+49 30 1234 5670')).toBeTruthy();

    const refreshed = person({
      ...klaus,
      role: null,
      phone: '+49 30 1234 5679',
    });
    mockContacts([erik, lena, refreshed]);
    rerender(tree());

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Klaus Vogt')).toBeTruthy();
    expect(within(dialog).getByText('+49 30 1234 5679')).toBeTruthy();
    expect(within(dialog).queryByText('+49 30 1234 5670')).toBeNull();
    expect(within(dialog).queryByText('VP Operations')).toBeNull();
    expect(rowFor('Klaus Vogt').getAttribute('data-cursor')).toBe('true');
    expect(rowFor('Erik Lindqvist').getAttribute('data-cursor')).toBeNull();
  });

  it('keeps a closed peek closed and the highlight on Lena Fischer', () => {
    // WHY: reordering the book is not Space. The highlight stays on the
    // person it was on, and the card does not open onto someone else.
    mockContacts([klaus, lena, erik]);
    const { rerender } = render(tree());

    fireEvent.keyDown(window, { key: 'j' });
    fireEvent.keyDown(window, { key: 'j' });
    expect(rowFor('Lena Fischer').getAttribute('data-cursor')).toBe('true');
    expect(screen.queryByRole('dialog')).toBeNull();

    mockContacts([erik, klaus, lena]);
    rerender(tree());

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(rowFor('Lena Fischer').getAttribute('data-cursor')).toBe('true');
    expect(rowFor('Erik Lindqvist').getAttribute('data-cursor')).toBeNull();
    expect(rowFor('Klaus Vogt').getAttribute('data-cursor')).toBeNull();
  });

  it('keeps the open card through the loading gap, then uses the settled row', () => {
    // WHY: a new search has no rows until it settles. Treating that gap as
    // an empty book closed Klaus Vogt and left the card closed after he
    // came back. The settled row is what the card shows, including a blank
    // title.
    mockContacts([klaus, lena]);
    const { rerender } = render(tree());

    fireEvent.keyDown(window, { key: 'j' });
    fireEvent.keyDown(window, { key: ' ' });
    expect(within(screen.getByRole('dialog')).getByText('+49 30 1234 5670')).toBeTruthy();

    mockContacts([], true);
    rerender(tree());

    expect(screen.getByRole('dialog').getAttribute('data-state')).toBe('open');
    expect(within(screen.getByRole('dialog')).getByText('VP Operations')).toBeTruthy();

    mockContacts([person({ ...klaus, role: null, phone: '+49 30 1234 5679' })]);
    rerender(tree());

    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('data-state')).toBe('open');
    expect(within(dialog).getByText('+49 30 1234 5679')).toBeTruthy();
    expect(within(dialog).queryByText('+49 30 1234 5670')).toBeNull();
    expect(within(dialog).queryByText('VP Operations')).toBeNull();
  });
});

// Clearing the contacts search updates the box before the list query.
// The rows still belong to the miss. Klaus Vogt is still in the demo book.
// The empty copy has to say nothing matched, not that the buying group is empty.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import '@/i18n';

import type { Contact } from '@bidstack/shared';

import { ContactTable } from './ContactTable';

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

function renderTable({
  items,
  search,
  deferredSearch,
}: {
  items: Contact[];
  search: string;
  deferredSearch: string;
}) {
  return render(
    <MemoryRouter>
      <ContactTable
        items={items}
        raw={items}
        search={search}
        setSearch={vi.fn()}
        deferredSearch={deferredSearch}
        isLoading={false}
        isError={false}
        error={null}
        refetch={vi.fn()}
        cursorIdx={-1}
        selectedIds={new Set()}
        allSelected={false}
        someSelected={false}
        toggleOne={vi.fn()}
        toggleAll={vi.fn()}
        sortState={{ key: null, dir: null }}
        setSortState={vi.fn()}
        updateContact={{ mutate: vi.fn(), isPending: false } as never}
        del={{ isPending: false } as never}
        setEditTarget={vi.fn()}
        onDelete={vi.fn()}
        setContextMenu={vi.fn()}
        canWrite={false}
        readOnlyHint="You need contacts write access to manage this contact."
      />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
});

describe('contacts list empty state', () => {
  it('does not call a cleared miss an empty buying group', () => {
    // WHY: the box is already empty, and the rows are still the search that
    // missed Klaus Vogt's phone. "Nobody in the buying group yet" would invite
    // a first contact into a demo book that already has him.
    renderTable({ items: [], search: '', deferredSearch: KLAUS_PHONE });

    expect(screen.getByRole('heading', { name: 'No matches' })).toBeTruthy();
    expect(screen.getByText(`Nothing matched "${KLAUS_PHONE}".`)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Nobody in the buying group yet' })).toBeNull();
    expect(screen.queryByRole('link', { name: /import contacts from CSV/i })).toBeNull();
    expect(screen.getByRole('status').textContent).toMatch(/matching \+49 30 1234 5670/i);
  });

  it('says the buying group is empty only when the settled query is empty', () => {
    // WHY: a workspace with no contacts, and a box that is only spaces, is a
    // first-run book. Spaces are not a search the server was asked to run.
    renderTable({ items: [], search: '   ', deferredSearch: '   ' });

    expect(screen.getByRole('heading', { name: 'Nobody in the buying group yet' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'No matches' })).toBeNull();
    expect(screen.getByRole('link', { name: /import contacts from CSV/i })).toBeTruthy();
  });

  it('keeps Klaus Vogt on screen when the settled query is the demo book', () => {
    // WHY: the empty headline is for zero rows. A loaded demo row is the book.
    renderTable({ items: [klaus()], search: '', deferredSearch: '' });

    expect(screen.getByRole('link', { name: 'Klaus Vogt' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Nobody in the buying group yet' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'No matches' })).toBeNull();
  });
});

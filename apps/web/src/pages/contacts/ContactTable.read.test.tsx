// The contacts table may say the book is empty only after a payload arrives.
// A load and a failed read have no rows yet. "Showing 0 contacts" is that lie.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import type { Contact } from '@bidstack/shared';

import { ContactTable, type ContactTableProps } from './ContactTable';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      key: string,
      fallback?: string | Record<string, unknown>,
      options?: Record<string, unknown>,
    ) => {
      const template = typeof fallback === 'string' ? fallback : key;
      const vars = typeof fallback === 'object' && fallback !== null ? fallback : options;
      return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
        vars && name in vars ? String(vars[name]) : '',
      );
    },
    i18n: { language: 'en' },
  }),
}));

const CHECKING = 'Checking contacts. They have not arrived.';
const EMPTY = 'Nobody in the buying group yet';
const FAILED = 'Could not load contacts';
const NOT_ARRIVED = 'The contacts have not arrived.';

function riley(): Contact {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    customer: 'Northwind Demo',
    name: 'Riley Example',
    role: 'Buyer',
    email: 'riley@example.test',
    phone: null,
    influence: 2,
    sentiment: 'warm',
    createdAt: '2026-01-15T00:00:00.000Z',
    companyId: null,
    linkState: 'needs_review',
  };
}

function renderTable(
  overrides: Partial<ContactTableProps> & Pick<ContactTableProps, 'items' | 'isLoading' | 'isError'>,
) {
  const props: ContactTableProps = {
    raw: overrides.raw ?? overrides.items,
    search: '',
    setSearch: vi.fn(),
    deferredSearch: '',
    error: null,
    refetch: vi.fn(),
    cursorIdx: -1,
    selectedIds: new Set<string>(),
    allSelected: false,
    someSelected: false,
    toggleOne: vi.fn(),
    toggleAll: vi.fn(),
    sortState: { key: null, dir: null },
    setSortState: vi.fn(),
    updateContact: { mutate: vi.fn(), isPending: false } as ContactTableProps['updateContact'],
    del: { mutate: vi.fn(), isPending: false } as ContactTableProps['del'],
    setEditTarget: vi.fn(),
    onDelete: vi.fn(async () => undefined),
    setContextMenu: vi.fn(),
    canWrite: false,
    readOnlyHint: 'You need contacts write access to manage this contact.',
    ...overrides,
  };
  return render(
    <MemoryRouter>
      <ContactTable {...props} />
    </MemoryRouter>,
  );
}

describe('ContactTable list read', () => {
  afterEach(() => cleanup());

  it('does not count a loading book as zero contacts', () => {
    // WHY: the first paint has no payload. The live region said the buying
    // group was empty while Riley Example was still on the way.
    renderTable({ items: [], isLoading: true, isError: false });

    expect(screen.queryByText(/0 contacts/)).toBeNull();
    expect(screen.queryByRole('heading', { name: EMPTY })).toBeNull();
    expect(screen.getByRole('status').textContent).toContain(CHECKING);
    expect(screen.queryByRole('link', { name: 'Riley Example' })).toBeNull();
  });

  it('does not count a failed read as zero contacts', () => {
    // WHY: the list failed. Riley Example may still be in the book. Zero
    // would say the workspace has no contacts.
    renderTable({
      items: [],
      isLoading: false,
      isError: true,
      error: new Error('offline'),
    });

    expect(screen.getByRole('heading', { name: FAILED })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain(NOT_ARRIVED);
    expect(screen.queryByText(/0 contacts/)).toBeNull();
    expect(screen.queryByRole('heading', { name: EMPTY })).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('says zero only after the book has settled empty', () => {
    // WHY: a workspace with no contacts is the first-run buying group.
    // Hiding that zero would make a real empty book look unfinished.
    renderTable({ items: [], isLoading: false, isError: false });

    expect(screen.getByRole('heading', { name: EMPTY })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('0 contacts');
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('counts Riley Example once the book has arrived', () => {
    // WHY: a settled payload is the book. The count has to name that page.
    const person = riley();
    renderTable({ items: [person], isLoading: false, isError: false });

    expect(screen.getByRole('link', { name: 'Riley Example' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('1 contact');
    expect(screen.queryByText(/0 contacts/)).toBeNull();
    expect(screen.queryByRole('heading', { name: EMPTY })).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });
});

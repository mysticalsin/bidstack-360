// The contacts list already holds companyId. A customer name that does not
// open that account forces a search, and a search can land on a different
// company. An unlinked name stays text.
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Contact } from '@bidstack/shared';

import { ContactTable } from './ContactTable';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback: string, values?: Record<string, unknown>) => {
      const text = fallback ?? key;
      if (!values) return text;
      return text.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(values[k] ?? ''));
    },
  }),
}));

const CI_FINANCIAL = 'c0000000-0000-4000-8000-000000000001';

function contact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    customer: 'CI Financial',
    name: 'Michael Johnson',
    role: 'Chief Information Officer',
    email: 'mjohnson@ci.com',
    phone: '+1 416 555 0142',
    influence: 5,
    sentiment: 'warm',
    createdAt: '2026-05-01T00:00:00.000Z',
    companyId: CI_FINANCIAL,
    linkState: 'linked',
    ...overrides,
  };
}

function renderTable(row: Contact) {
  return render(
    <MemoryRouter>
      <ContactTable
        items={[row]}
        raw={[row]}
        search=""
        setSearch={vi.fn()}
        deferredSearch=""
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
        canWrite
        readOnlyHint="You need contacts write access to manage this contact."
      />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
});

describe('contacts list account link', () => {
  it('opens CI Financial on the account the contact stores', () => {
    renderTable(contact());

    const account = screen.getByRole('link', { name: 'Open account CI Financial' });
    expect(account.getAttribute('href')).toBe(`/accounts/${CI_FINANCIAL}`);
    expect(account.className).toContain('min-h-[44px]');
    expect(account.className).toContain('dark:text-[var(--brand-deep)]');
  });

  it('leaves an unlinked customer as text', () => {
    renderTable(contact({ companyId: null, linkState: 'needs_review', customer: 'Globex' }));

    expect(screen.queryByRole('link', { name: /Globex/ })).toBeNull();
    expect(screen.getByText('Globex')).toBeTruthy();
  });
});

// Dark mode splits the green: --brand-primary (#00805e) is a fill and is
// 3.95:1 on the page, under the 4.5:1 text floor. --brand-deep (#3fbe93) is
// the foreground accent at 8.38:1. The contacts list still paints Michael
// Johnson and mjohnson@ci.com in the fill green, and the hit area is the
// line box, under 44px. Those two links are how a row opens the person and
// the mail client.
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
      return text.replace(/\{\{(\w+)\}\}/g, (_match, token: string) => String(values[token] ?? ''));
    },
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

function expectsReadableTarget(link: HTMLElement) {
  expect(link.className).toContain('dark:text-[var(--brand-deep)]');
  expect(link.className).toContain('min-h-[44px]');
  expect(link.className).toContain('focus-visible:ring-2');
  expect(link.className).toContain('dark:focus-visible:ring-[var(--brand-deep)]');
}

afterEach(() => {
  cleanup();
});

describe('contacts list person links', () => {
  it('opens Michael Johnson in the foreground green with a 44px target', () => {
    // WHY: the name is the row's way onto the record. Fill green fails the
    // text contrast floor in dark mode, and a line-height link is under 44px.
    renderTable(contact());

    const name = screen.getByRole('link', { name: 'Michael Johnson' });
    expect(name.getAttribute('href')).toBe(`/contacts/${MICHAEL}`);
    expectsReadableTarget(name);
  });

  it('opens the demo email in the same foreground green and target', () => {
    // WHY: mjohnson@ci.com is the mail action on the row. It uses the same
    // fill green and the same short hit area as the name.
    renderTable(contact());

    const email = screen.getByRole('link', { name: 'mjohnson@ci.com' });
    expect(email.getAttribute('href')).toBe('mailto:mjohnson@ci.com');
    expectsReadableTarget(email);
  });

  it('keeps a row with no email off a blank mail link', () => {
    // WHY: a missing address is not a control. The name still has to be readable.
    renderTable(contact({ email: null, phone: null }));

    expect(screen.queryByRole('link', { name: /mailto|@/ })).toBeNull();
    expectsReadableTarget(screen.getByRole('link', { name: 'Michael Johnson' }));
    expect(screen.getByText('—')).toBeTruthy();
  });
});

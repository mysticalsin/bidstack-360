// The contacts list prints a phone under the email. Klaus Vogt's number
// +49 30 1234 5670 is plain text, and the demo book stores phones with
// spaces, so the printed string is not a call. The email beside it is
// already a mail link.
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

const KLAUS = '11111111-1111-4111-8111-111111111111';

function contact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: KLAUS,
    customer: 'Siemens',
    name: 'Klaus Vogt',
    role: 'VP Operations',
    email: 'klaus.vogt.demo@example.com',
    phone: '+49 30 1234 5670',
    influence: 5,
    sentiment: 'hot',
    createdAt: '2026-05-01T00:00:00.000Z',
    companyId: 'c0000000-0000-4000-8000-000000000010',
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

function expectsCallTarget(link: HTMLElement) {
  expect(link.className).toContain('min-h-[44px]');
  expect(link.className).toContain('focus-visible:ring-2');
  expect(link.className).toContain('dark:text-[var(--brand-deep)]');
  expect(link.className).toContain('dark:focus-visible:ring-[var(--brand-deep)]');
}

afterEach(() => {
  cleanup();
});

describe('contacts list call', () => {
  it('calls the spaced phone Klaus Vogt\'s row prints', () => {
    // WHY: the Contact column is where the list reaches this person. The
    // email already mails. +49 30 1234 5670 has to dial, and a line-height
    // hit area is under 44px.
    renderTable(contact());

    const call = screen.getByRole('link', { name: 'Call +49 30 1234 5670' });
    expect(call.getAttribute('href')).toBe('tel:+493012345670');
    expect(call.textContent).toBe('+49 30 1234 5670');
    expectsCallTarget(call);

    const mail = screen.getByRole('link', { name: 'klaus.vogt.demo@example.com' });
    expect(mail.getAttribute('href')).toBe('mailto:klaus.vogt.demo@example.com');
    // The call link sits under this address. A line-height mail target fails
    // the axe target-size rule once a 44px control is adjacent.
    expect(mail.className).toContain('min-h-[44px]');
  });

  it('leaves a fragment as text', () => {
    // WHY: "12" is not the demo phone. A missing number is not a control.
    renderTable(contact({ phone: '12' }));

    expect(screen.queryByRole('link', { name: /Call/ })).toBeNull();
    expect(screen.getByText('12').closest('a')).toBeNull();
  });

  it('does not invent a call when the row has no phone', () => {
    // WHY: an empty phone is the em dash, not a tel link.
    renderTable(contact({ phone: null, email: null }));

    expect(screen.queryByRole('link', { name: /Call|tel:/ })).toBeNull();
    expect(screen.getByText('—')).toBeTruthy();
  });
});

// Right-click on the contacts list is the menu for one person. Michael
// Johnson's phone +1 416 555 0142 can be copied, and the demo book stores
// phones with spaces, so the copied string is not a call. The name is not
// an action, so the menu cannot open the record. The items are a line box,
// under 44px, and arrow keys fall through to the table cursor.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Contact } from '@bidstack/shared';

import { ContactContextMenu } from './ContactContextMenu';

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

function renderMenu(row: Contact) {
  return render(
    <MemoryRouter>
      <ContactContextMenu
        x={80}
        y={80}
        contact={row}
        onClose={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    </MemoryRouter>,
  );
}

function expectsTarget(item: HTMLElement) {
  expect(item.className).toContain('min-h-11');
  expect(item.className).toContain('focus-visible:ring-2');
  expect(item.className).toContain('dark:focus-visible:ring-[var(--brand-deep)]');
}

afterEach(() => {
  cleanup();
});

describe('contact context menu', () => {
  it('opens Michael Johnson and calls the spaced phone the row prints', () => {
    // WHY: the menu is how a right-click reaches this person. The name has
    // to open the record, and +1 416 555 0142 has to dial. A line-height
    // item is under 44px.
    renderMenu(contact());

    const open = screen.getByRole('menuitem', { name: 'Open Michael Johnson' });
    expect(open.getAttribute('href')).toBe(`/contacts/${MICHAEL}`);
    expectsTarget(open);

    const mail = screen.getByRole('menuitem', { name: 'Email mjohnson@ci.com' });
    expect(mail.getAttribute('href')).toBe('mailto:mjohnson@ci.com');
    expectsTarget(mail);

    const call = screen.getByRole('menuitem', { name: 'Call +1 416 555 0142' });
    expect(call.getAttribute('href')).toBe('tel:+14165550142');
    expectsTarget(call);

    expectsTarget(screen.getByRole('menuitem', { name: 'Edit contact' }));
    expect(screen.getByRole('menuitem', { name: 'Copy email' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Copy phone' })).toBeTruthy();
  });

  it('does not invent a record, a mail, or a call', () => {
    // WHY: a missing address is not a control. "12" is not the demo phone.
    // A name that is not a contact id must not become a route. Copy still
    // offers the stored fragment.
    renderMenu(
      contact({
        id: 'not-a-contact',
        email: null,
        phone: '12',
      }),
    );

    expect(screen.queryByRole('menuitem', { name: /Open|Email|Call/ })).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Copy phone' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Copy email' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Edit contact' })).toBeTruthy();
  });

  it('keeps arrow keys inside the menu', () => {
    // WHY: the contacts table also listens for ArrowDown. A key that moves
    // the menu must not keep traveling to that cursor.
    renderMenu(contact());
    const menu = screen.getByRole('menu');
    const seen: string[] = [];
    const hear = (event: Event) => {
      seen.push((event as KeyboardEvent).key);
    };
    window.addEventListener('keydown', hear);

    fireEvent.keyDown(menu, { key: 'ArrowDown' });

    window.removeEventListener('keydown', hear);
    expect(seen).not.toContain('ArrowDown');
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Email mjohnson@ci.com' }));
    expect(screen.getByRole('menu')).toBeTruthy();
  });
});

// Demo contacts store phones with spaces, such as Klaus Vogt at Siemens
// (+49 30 1234 5670). The record turned that string into the tel href, so the
// printed number was not a dial target. The email beside it is already a mail link.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const contact = vi.hoisted(() => ({
  phone: '+49 30 1234 5670' as string | null,
  email: 'klaus.vogt.demo@example.com' as string | null,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback: string, values?: Record<string, unknown>) => {
      const text = fallback ?? key;
      if (!values) return text;
      return text.replace(/\{\{(\w+)\}\}/g, (_match, token: string) => String(values[token] ?? ''));
    },
  }),
}));

vi.mock('@/hooks/useContacts', () => ({
  useContact: () => ({
    isLoading: false,
    isError: false,
    data: {
      id: '00000000-0000-4000-8000-000000000010',
      customer: 'Siemens',
      name: 'Klaus Vogt',
      role: 'VP Operations',
      email: contact.email,
      phone: contact.phone,
      influence: 5,
      sentiment: 'hot',
      createdAt: '2026-05-01T00:00:00.000Z',
      companyId: null,
      linkState: 'needs_review',
    },
  }),
}));

vi.mock('@/hooks/useOpportunities', () => ({
  useOpportunities: () => ({ data: { items: [], nextCursor: null } }),
}));
vi.mock('@/hooks/useTasks', () => ({ useTasks: () => ({ data: { items: [] } }) }));
vi.mock('@/hooks/useNotes', () => ({ useNotes: () => ({ data: { items: [] } }) }));
vi.mock('@/components/CustomFieldValuesSection', () => ({ CustomFieldValuesSection: () => null }));
vi.mock('@/components/email/EmailPanel', () => ({ EmailPanel: () => null }));
vi.mock('@/components/editor/CollaborativeNotesSection', () => ({
  CollaborativeNotesSection: () => null,
}));
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useParams: () => ({ id: '00000000-0000-4000-8000-000000000010' }) };
});

import { ContactDetailPage } from './ContactDetailPage';

function renderRecord() {
  render(
    <MemoryRouter>
      <ContactDetailPage />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  contact.phone = '+49 30 1234 5670';
  contact.email = 'klaus.vogt.demo@example.com';
});

describe('contact record phone', () => {
  it('calls the phone the record prints, as digits', () => {
    renderRecord();

    const call = screen.getByRole('link', { name: 'Call +49 30 1234 5670' });
    expect(call.getAttribute('href')).toBe('tel:+493012345670');
    expect(call.textContent).toContain('+49 30 1234 5670');
    expect(call.className).toContain('min-h-11');
    expect(call.className).toContain('focus-visible:ring-2');
    expect(call.className).toContain('dark:focus-visible:ring-[var(--brand-deep)]');

    const mail = screen.getByRole('link', { name: 'klaus.vogt.demo@example.com' });
    expect(mail.getAttribute('href')).toBe('mailto:klaus.vogt.demo@example.com');
  });

  it('keeps a fragment and a missing phone off a call link', () => {
    contact.phone = 'ext 12';
    renderRecord();
    expect(screen.queryByRole('link', { name: /Call / })).toBeNull();
    expect(screen.getByText('ext 12')).toBeTruthy();
    expect(document.querySelector('a[href^="tel:"]')).toBeNull();

    cleanup();
    contact.phone = null;
    renderRecord();
    expect(screen.queryByRole('link', { name: /Call / })).toBeNull();
    expect(document.querySelector('a[href^="tel:"]')).toBeNull();
  });
});

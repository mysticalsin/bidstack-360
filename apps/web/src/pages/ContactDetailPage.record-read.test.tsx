// A paused or in-flight contact read has no person yet. The detail page
// used the same "Contact not found" line as a settled miss, which tells
// the reader the record was deleted. The payload has not arrived.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { ContactDetailPage } from './ContactDetailPage';
import { useContact } from '@/hooks/useContacts';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    i18n: { language: 'en' },
  }),
}));

vi.mock('@/hooks/useContacts', () => ({
  useContact: vi.fn(),
}));

vi.mock('@/hooks/useOpportunities', () => ({
  useOpportunities: vi.fn(() => ({ data: undefined })),
}));
vi.mock('@/hooks/useTasks', () => ({
  useTasks: vi.fn(() => ({ data: undefined })),
}));
vi.mock('@/hooks/useNotes', () => ({
  useNotes: vi.fn(() => ({ data: undefined })),
}));
vi.mock('@/components/CustomFieldValuesSection', () => ({
  CustomFieldValuesSection: () => null,
}));
vi.mock('@/components/email/EmailPanel', () => ({ EmailPanel: () => null }));
vi.mock('@/components/editor/CollaborativeNotesSection', () => ({
  CollaborativeNotesSection: () => null,
}));
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useParams: () => ({ id: 'c-unread' }) };
});

const NOT_FOUND = 'Contact not found';
const DELETED = 'The contact may have been deleted or you may not have access to it.';
const CHECKING = 'Checking this contact';
const NOT_ARRIVED = 'The contact has not arrived.';

function mockContact(value: Record<string, unknown>) {
  vi.mocked(useContact).mockReturnValue(value as ReturnType<typeof useContact>);
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ContactDetailPage />
    </MemoryRouter>,
  );
}

describe('ContactDetailPage record read', () => {
  afterEach(() => cleanup());

  it('does not call a paused contact read a missing person', () => {
    mockContact({
      data: undefined,
      isLoading: false,
      isPending: true,
      isError: false,
      error: null,
      status: 'pending',
      fetchStatus: 'paused',
    });

    renderPage();

    expect(screen.queryByText(NOT_FOUND)).toBeNull();
    expect(screen.queryByText(DELETED)).toBeNull();
    expect(screen.getByRole('status').textContent).toContain(CHECKING);
    expect(screen.getByRole('status').textContent).toContain(NOT_ARRIVED);
  });

  it('does not call an in-flight contact read a missing person', () => {
    mockContact({
      data: undefined,
      isLoading: true,
      isPending: true,
      isError: false,
      error: null,
      status: 'pending',
      fetchStatus: 'fetching',
    });

    renderPage();

    expect(screen.queryByText(NOT_FOUND)).toBeNull();
    expect(screen.getByRole('status').textContent).toContain(CHECKING);
    expect(screen.getByRole('status').textContent).toContain(NOT_ARRIVED);
  });

  it('keeps a failed contact read on the error, not on not-found', () => {
    mockContact({
      data: undefined,
      isLoading: false,
      isPending: false,
      isError: true,
      error: new Error('Contact not found'),
      status: 'error',
      fetchStatus: 'idle',
    });

    renderPage();

    expect(screen.getByText("Couldn't load contact")).toBeTruthy();
    expect(screen.queryByRole('heading', { name: NOT_FOUND })).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('still says the contact is missing after a settled read with no person', () => {
    mockContact({
      data: undefined,
      isLoading: false,
      isPending: false,
      isError: false,
      error: null,
      status: 'success',
      fetchStatus: 'idle',
    });

    renderPage();

    expect(screen.getByText(NOT_FOUND)).toBeTruthy();
    expect(screen.getByText(DELETED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('still shows the person once the contact payload has arrived', () => {
    mockContact({
      data: {
        id: 'c-1',
        customer: 'Northwind Demo',
        name: 'Riley Example',
        role: 'Buyer',
        email: null,
        phone: null,
        influence: null,
        sentiment: null,
        createdAt: '2026-01-15T00:00:00.000Z',
        companyId: null,
        linkState: 'needs_review',
      },
      isLoading: false,
      isPending: false,
      isError: false,
      error: null,
      status: 'success',
      fetchStatus: 'idle',
    });

    renderPage();

    expect(screen.getByRole('heading', { name: 'Riley Example' })).toBeTruthy();
    expect(screen.queryByText(NOT_FOUND)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });
});

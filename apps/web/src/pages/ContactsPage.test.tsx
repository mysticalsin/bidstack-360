import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ContactsPage } from './ContactsPage';
import { useContacts } from '@/hooks/useContacts';
import { useHasPermission } from '@/hooks/useCapabilities';
import type { Contact } from '@bidstack/shared';

// POST/PATCH/DELETE /api/contacts are gated server-side behind contacts:write
// (apps/api/src/routes/contacts.ts) — the write affordances must reflect
// that, not just show controls that always 403 on click.
vi.mock('@/hooks/useContacts', () => ({
  useContacts: vi.fn(),
  useCreateContact: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
  useDeleteContact: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
  useUpdateContact: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
}));

vi.mock('@/hooks/useCapabilities', () => ({ useHasPermission: vi.fn() }));

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

function mockContacts(value: Partial<ReturnType<typeof useContacts>>) {
  vi.mocked(useContacts).mockReturnValue(value as ReturnType<typeof useContacts>);
}

function baseContact(): Contact {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    customer: 'Acme Corp',
    name: 'Jane Doe',
    role: 'CTO',
    email: 'jane@acme.com',
    phone: null,
    influence: 4,
    sentiment: 'warm',
    createdAt: new Date().toISOString(),
  };
}

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ContactsPage — contacts:write gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockContacts({
      data: { items: [baseContact()], nextCursor: null },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('hides New contact and disables row Delete for a user without contacts:write', () => {
    vi.mocked(useHasPermission).mockReturnValue(false);

    renderWithProviders(<ContactsPage />);

    expect(screen.queryByRole('button', { name: /Create a new contact/i })).toBeNull();

    // Row aria-labels are interpolated via t(), which react-i18next can't
    // resolve without an initialized instance in this test env — scope by
    // the row instead of matching the (unsubstituted) accessible name.
    const row = screen.getByText('Jane Doe').closest('tr')!;
    const del = within(row).getByRole('button', { name: /Delete/i }) as HTMLButtonElement;
    expect(del.disabled).toBe(true);
    expect(del.title).toMatch(/contacts write access/i);

    // Read access stays intact — the record link and its data still render.
    expect(screen.getByRole('link', { name: 'Jane Doe' })).toBeTruthy();
  });

  it('shows New contact and an enabled row Delete for a user with contacts:write', () => {
    vi.mocked(useHasPermission).mockReturnValue(true);

    renderWithProviders(<ContactsPage />);

    expect(screen.getByRole('button', { name: /Create a new contact/i })).toBeTruthy();

    const row = screen.getByText('Jane Doe').closest('tr')!;
    const del = within(row).getByRole('button', { name: /Delete/i }) as HTMLButtonElement;
    expect(del.disabled).toBe(false);
    expect(del.title).toBeFalsy();
  });

  it('hides the bulk-action-bar Delete selected control without contacts:write', () => {
    vi.mocked(useHasPermission).mockReturnValue(false);

    renderWithProviders(<ContactsPage />);

    const row = screen.getByText('Jane Doe').closest('tr')!;
    fireEvent.click(within(row).getByRole('checkbox'));
    expect(screen.queryByRole('button', { name: /Delete selected/i })).toBeNull();
    // Clear stays since it's local-only state, not a write.
    expect(screen.getByRole('button', { name: /^Clear$/i })).toBeTruthy();
  });

  it('shows the bulk-action-bar Delete selected control with contacts:write', () => {
    vi.mocked(useHasPermission).mockReturnValue(true);

    renderWithProviders(<ContactsPage />);

    const row = screen.getByText('Jane Doe').closest('tr')!;
    fireEvent.click(within(row).getByRole('checkbox'));
    expect(screen.getByRole('button', { name: /Delete selected/i })).toBeTruthy();
  });

  it('hides Import CSV for a user without contacts:write', () => {
    // ContactCsvImportDialog drives per-row POST /api/contacts; a reader-role
    // user could walk the whole multi-step flow and only fail on the final
    // confirm. It must be gated exactly like New contact.
    vi.mocked(useHasPermission).mockReturnValue(false);

    renderWithProviders(<ContactsPage />);

    expect(screen.queryByRole('button', { name: /Import contacts from CSV/i })).toBeNull();
  });

  it('shows Import CSV for a user with contacts:write', () => {
    vi.mocked(useHasPermission).mockReturnValue(true);

    renderWithProviders(<ContactsPage />);

    expect(screen.getByRole('button', { name: /Import contacts from CSV/i })).toBeTruthy();
  });

  it('hides the empty-state "Add first contact" action for a user without contacts:write', () => {
    vi.mocked(useHasPermission).mockReturnValue(false);
    mockContacts({
      data: { items: [], nextCursor: null },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithProviders(<ContactsPage />);

    expect(screen.queryByRole('button', { name: /Add first contact/i })).toBeNull();
  });
});

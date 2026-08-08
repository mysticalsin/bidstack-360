import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { LeadDetailPage } from './LeadDetailPage';
import { useLead } from '@/hooks/useLeads';
import { useHasPermission } from '@/hooks/useCapabilities';

// Status/priority/score/source/BANT/notes PATCH, convert, and delete are all
// gated server-side behind leads:write (apps/api/src/routes/leads.write.routes.ts)
// — a role without it must see disabled controls instead of ones that 403.
vi.mock('@/hooks/useLeads', () => ({
  useLead: vi.fn(),
  useUpdateLead: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useConvertLead: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useDeleteLead: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

vi.mock('@/hooks/useCapabilities', () => ({ useHasPermission: vi.fn() }));

vi.mock('@/components/CustomFieldValuesSection', () => ({
  CustomFieldValuesSection: () => null,
}));

vi.mock('@/components/editor/CollaborativeNotesSection', () => ({
  CollaborativeNotesSection: () => null,
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useParams: () => ({ id: 'lead-1' }) };
});

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

function baseLead() {
  return {
    id: 'lead-1',
    firstName: 'Jane',
    lastName: 'Doe',
    email: 'jane@acme.com',
    phone: null,
    companyName: 'Acme Corp',
    title: 'VP Eng',
    source: 'website',
    status: 'new' as const,
    score: 42,
    priority: 'medium' as const,
    ownerId: null,
    ownerName: null,
    convertedToOpportunityId: null,
    statusChangedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    notes: null,
    budget: null,
    authority: null,
    need: null,
    timeline: null,
    intel: null,
  };
}

function mockLead(data: ReturnType<typeof baseLead> | undefined, overrides: Partial<ReturnType<typeof useLead>> = {}) {
  vi.mocked(useLead).mockReturnValue({
    data,
    isLoading: false,
    isError: false,
    ...overrides,
  } as unknown as ReturnType<typeof useLead>);
}

function renderWithProviders() {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <LeadDetailPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('LeadDetailPage — leads:write gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLead(baseLead());
  });

  afterEach(() => {
    cleanup();
  });

  it('disables status/priority/BANT/convert/delete controls for a user without leads:write', () => {
    vi.mocked(useHasPermission).mockReturnValue(false);

    renderWithProviders();

    const hint = 'You need lead write access to make changes.';
    const status = screen.getByLabelText(/^Status/i) as HTMLSelectElement;
    const priority = screen.getByLabelText(/^Priority/i) as HTMLSelectElement;
    expect(status.disabled).toBe(true);
    expect(priority.disabled).toBe(true);
    expect(status.getAttribute('title')).toBe(hint);
    // `title` is mouse-only — the accessible name itself must carry the
    // reason so screen-reader/keyboard users get it too.
    expect(status.getAttribute('aria-label')).toBe(`Status — ${hint}`);
    expect(priority.getAttribute('aria-label')).toBe(`Priority — ${hint}`);
    expect(
      (screen.getByPlaceholderText('e.g. €500K') as HTMLInputElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByPlaceholderText('Decision maker') as HTMLInputElement).disabled,
    ).toBe(true);
    const convertButton = screen.getByRole('button', {
      name: /Convert to opportunity/i,
    }) as HTMLButtonElement;
    expect(convertButton.disabled).toBe(true);
    expect(convertButton.getAttribute('aria-label')).toBe(`Convert to opportunity — ${hint}`);
    const deleteButton = screen.getByRole('button', { name: /^Delete/i }) as HTMLButtonElement;
    expect(deleteButton.disabled).toBe(true);
    expect(deleteButton.getAttribute('aria-label')).toBe(`Delete — ${hint}`);
  });

  it('enables status/priority/BANT/convert/delete controls for a user with leads:write', () => {
    vi.mocked(useHasPermission).mockReturnValue(true);

    renderWithProviders();

    expect((screen.getByLabelText(/^Status$/i) as HTMLSelectElement).disabled).toBe(false);
    expect((screen.getByLabelText(/^Priority$/i) as HTMLSelectElement).disabled).toBe(false);
    expect(
      (screen.getByPlaceholderText('e.g. €500K') as HTMLInputElement).disabled,
    ).toBe(false);
    expect(
      (screen.getByRole('button', { name: /Convert to opportunity/i }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    expect((screen.getByRole('button', { name: /^Delete$/i }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });
});

// The record header prints the stored source key. Polar Foods is
// cold_outreach, so the header says cold_outreach while the new-lead
// form says Cold outreach.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { LeadDetailPage } from './LeadDetailPage';
import { useLead } from '@/hooks/useLeads';
import { useHasPermission } from '@/hooks/useCapabilities';

vi.mock('@/hooks/useLeads', () => ({
  useLead: vi.fn(),
  useUpdateLead: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useConvertLead: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useDeleteLead: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));
vi.mock('@/hooks/useCapabilities', () => ({ useHasPermission: vi.fn(() => true) }));
vi.mock('@/components/CustomFieldValuesSection', () => ({
  CustomFieldValuesSection: () => null,
}));
vi.mock('@/components/editor/CollaborativeNotesSection', () => ({
  CollaborativeNotesSection: () => null,
}));
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useParams: () => ({ id: 'lead-polar' }) };
});

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

function polarFoods() {
  return {
    id: 'lead-polar',
    firstName: 'Daniel',
    lastName: 'Korhonen',
    email: 'daniel.korhonen@example.com',
    phone: null,
    companyName: 'Polar Foods',
    title: 'VP IT',
    source: 'cold_outreach',
    status: 'nurture' as const,
    score: 42,
    priority: 'low' as const,
    ownerId: null,
    ownerName: 'Sofia Almeida',
    convertedToOpportunityId: null,
    statusChangedAt: '2026-05-01T00:00:00.000Z',
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    notes: null,
    budget: null,
    authority: null,
    need: null,
    timeline: null,
    intel: null,
  };
}

describe('LeadDetailPage source label', () => {
  beforeEach(() => {
    vi.mocked(useLead).mockReturnValue({
      data: polarFoods(),
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useLead>);
    vi.mocked(useHasPermission).mockReturnValue(true);
  });

  afterEach(cleanup);

  it('names Polar Foods cold_outreach on the record, not the stored key', () => {
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <LeadDetailPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.getAllByText('Cold outreach').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText('cold_outreach')).toBeNull();
    expect(screen.queryByText('Cold_outreach')).toBeNull();
  });
});

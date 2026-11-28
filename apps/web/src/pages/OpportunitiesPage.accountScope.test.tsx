// A cockpit "Open pipeline" click arrives as ?companyId=. The list has to ask
// for that company. The strip above it is the workspace summary, so without
// a scope switch the page would show one Logistec bid under a 40-bid book.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { OpportunitiesPage } from './OpportunitiesPage';
import { useOpportunities } from '@/hooks/useOpportunities';
import { useOrgSummary } from '@/hooks/useOrgSummary';

vi.mock('@/hooks/useOpportunities', () => ({
  useOpportunities: vi.fn(),
  usePatchOpportunity: vi.fn(() => ({ mutate: vi.fn() })),
  useCreateOpportunity: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));
vi.mock('@/hooks/useCapabilities', () => ({ useHasPermission: vi.fn(() => true) }));
vi.mock('@/hooks/useStageMutation', () => ({
  useStageMutation: vi.fn(() => ({ mutateAsync: vi.fn() })),
}));
vi.mock('@/hooks/usePipelineStages', () => ({
  usePipelineStages: vi.fn(() => ({ data: { items: [] }, isLoading: false, isError: false })),
}));
vi.mock('@/hooks/useTerritories', () => ({
  useTerritorySegments: vi.fn(() => ({
    data: {
      dimension: 'industry',
      items: [],
      totals: { totalSegments: 0, totalValueMicros: 0, totalOpportunities: 0, avgProbability: 0 },
    },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  })),
}));
vi.mock('@/hooks/useOrgSummary', () => ({
  useOrgSummary: vi.fn(),
}));

const LOGISTEC = '11111111-1111-4111-8111-111111111111';

function renderAt(url: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>
        <OpportunitiesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function oneBid() {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    code: 'OP-2042',
    name: 'Logistec Corporation — SOC 2 Readiness',
    customer: 'Logistec Corporation',
    stage: 's1_ongoing',
    pipelineStageId: null,
    pipelineStage: null,
    value: 320000,
    probability: 35,
    dueDate: '2026-08-15',
    owner: null,
    industry: 'transportation',
    logo: null,
    country: 'CA',
    territoryId: null,
    territoryName: null,
    updatedAt: '2026-08-01T00:00:00.000Z',
    taskCount: 0,
    commentCount: 0,
    viewCount: 0,
  };
}

describe('OpportunitiesPage account scope', () => {
  afterEach(cleanup);

  it("asks for this company and does not wear the book's totals", () => {
    vi.mocked(useOpportunities).mockReturnValue({
      data: { items: [oneBid()], nextCursor: null },
      isLoading: false,
      isError: false,
      error: null,
    } as never);
    vi.mocked(useOrgSummary).mockReturnValue({
      data: {
        companies: 12,
        contacts: 20,
        leads: 3,
        opportunities: 40,
        openOpportunities: 30,
        pipelineValue: 9_000_000,
        tasks: 7,
        overdueTasks: 7,
        serviceCases: 0,
        openServiceCases: 0,
        recentActivity: [],
      },
      isLoading: false,
      isError: false,
    } as never);

    renderAt(`/opportunities?companyId=${LOGISTEC}`);

    expect(vi.mocked(useOpportunities).mock.calls.at(-1)?.[0]).toMatchObject({
      companyId: LOGISTEC,
    });
    expect(screen.getByRole('region', { name: 'Filtered opportunities on this page' })).toBeTruthy();
    expect(screen.queryByText('40')).toBeNull();
    expect(screen.getAllByText(/This account's bids/).length).toBeGreaterThan(0);
  });

  it('ignores a company id that is not a uuid', () => {
    vi.mocked(useOpportunities).mockReturnValue({
      data: { items: [oneBid()], nextCursor: null },
      isLoading: false,
      isError: false,
      error: null,
    } as never);
    vi.mocked(useOrgSummary).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
    } as never);

    renderAt('/opportunities?companyId=logistec');

    const filter = vi.mocked(useOpportunities).mock.calls.at(-1)?.[0] as { companyId?: string };
    expect(filter.companyId).toBeUndefined();
  });

  it('says the account has no bids instead of claiming the book is empty', () => {
    vi.mocked(useOpportunities).mockReturnValue({
      data: { items: [], nextCursor: null },
      isLoading: false,
      isError: false,
      error: null,
    } as never);
    vi.mocked(useOrgSummary).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
    } as never);

    renderAt(`/opportunities?companyId=${LOGISTEC}`);

    expect(screen.getByText('No bids for this account')).toBeTruthy();
    expect(screen.queryByText('No open bids yet')).toBeNull();
  });
});

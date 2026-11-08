import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { OpportunitiesPage } from './OpportunitiesPage';
import { useOpportunities } from '@/hooks/useOpportunities';
import { downloadFromApi } from '@/lib/api';

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  downloadFromApi: vi.fn(async () => undefined),
}));
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

describe('OpportunitiesPage CSV export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useOpportunities).mockReturnValue({
      data: {
        items: [
          {
            id: '11111111-1111-1111-1111-111111111111',
            code: 'OP-0001',
            name: 'Acme Upgrade',
            customer: 'Acme Corp',
            stage: 's1_lead',
            pipelineStageId: null,
            pipelineStage: null,
            value: 10000,
            probability: 20,
            dueDate: '2026-10-10',
            owner: 'owner@example.com',
            industry: 'Consulting',
            logo: null,
            country: 'FR',
            territoryId: null,
            territoryName: null,
            updatedAt: new Date().toISOString(),
            taskCount: 0,
            commentCount: 0,
            viewCount: 0,
          },
        ],
        nextCursor: null,
      },
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useOpportunities>);
  });
  afterEach(() => cleanup());

  it('sends the search and due filters on screen, not just the stage', async () => {
    renderAt('/opportunities?search=acme&due=overdue');
    fireEvent.click(screen.getByRole('button', { name: /Export visible opportunities as CSV/i }));
    await waitFor(() => expect(downloadFromApi).toHaveBeenCalled());
    const opts = vi.mocked(downloadFromApi).mock.calls[0]?.[2];
    expect(opts?.querystring).toEqual({ search: 'acme', overdue: 'true' });
  });

  it('sends the 7-day window for the "Due ≤ 7d" chip', async () => {
    renderAt('/opportunities?due=within7');
    fireEvent.click(screen.getByRole('button', { name: /Export visible opportunities as CSV/i }));
    await waitFor(() => expect(downloadFromApi).toHaveBeenCalled());
    expect(vi.mocked(downloadFromApi).mock.calls[0]?.[2]?.querystring).toEqual({
      dueWithinDays: '7',
    });
  });
});

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { OpportunitiesPage } from './OpportunitiesPage';
import { useOpportunities } from '@/hooks/useOpportunities';
import { downloadFromApi } from '@/lib/api';

// The default pipeline names the column "Technical Iteration". The seed stores
// the key s3_technical_iteration and leaves pipelineStageId null (OP-2041).
const TECHNICAL_ITERATION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

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
  usePipelineStages: vi.fn(() => ({
    data: {
      items: [
        {
          id: TECHNICAL_ITERATION,
          key: 's3_technical_iteration',
          name: 'Technical Iteration',
          orderIndex: 3,
          probability: 65,
          forecastCategory: 'commit',
          isWon: false,
          isLost: false,
          color: '#06b6d4',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    },
    isLoading: false,
    isError: false,
  })),
}));

vi.mock('@/hooks/useOrgSummary', () => ({
  useOrgSummary: vi.fn(() => ({ data: undefined, isLoading: false, isError: false })),
}));

vi.mock('@/hooks/useTerritories', () => ({
  useTerritorySegments: vi.fn(() => ({
    data: {
      dimension: 'industry',
      items: [],
      totals: {
        totalSegments: 0,
        totalValueMicros: 0,
        totalOpportunities: 0,
        avgProbability: 0,
      },
    },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  })),
}));

function seededBid() {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    code: 'OP-2041',
    name: 'CI Financial IT Modernization and MSP',
    customer: 'CI Financial',
    stage: 's3_technical_iteration',
    pipelineStageId: null,
    pipelineStage: null,
    value: 1_240_000,
    probability: 65,
    dueDate: '2026-07-22',
    owner: 'alex.example@example.test',
    industry: 'financial_services',
    logo: null,
    country: 'CA',
    territoryId: null,
    territoryName: null,
    updatedAt: '2026-07-01T00:00:00.000Z',
    taskCount: 0,
    commentCount: 0,
    viewCount: 0,
  };
}

function renderAt(url: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[url]}>
        <OpportunitiesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('OpportunitiesPage demo stage chip', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('filters Technical Iteration by the stage key the seed stored', () => {
    vi.mocked(useOpportunities).mockReturnValue({
      data: { items: [seededBid()], nextCursor: null },
      isLoading: false,
      isError: false,
      error: null,
    } as ReturnType<typeof useOpportunities>);

    renderAt('/opportunities');

    fireEvent.click(screen.getByRole('button', { name: 'Technical Iteration' }));

    const lastCall = vi.mocked(useOpportunities).mock.calls.at(-1)?.[0];
    expect(lastCall).toMatchObject({ stage: 's3_technical_iteration' });
    expect(lastCall).not.toHaveProperty('pipelineStageId');
  });

  it('exports that same stage key, not the empty UUID match', async () => {
    vi.mocked(useOpportunities).mockReturnValue({
      data: { items: [seededBid()], nextCursor: null },
      isLoading: false,
      isError: false,
      error: null,
    } as ReturnType<typeof useOpportunities>);

    renderAt(`/opportunities?pipelineStageId=${TECHNICAL_ITERATION}`);

    fireEvent.click(screen.getByRole('button', { name: /Export visible opportunities as CSV/i }));

    await waitFor(() => expect(downloadFromApi).toHaveBeenCalled());
    expect(vi.mocked(downloadFromApi).mock.calls[0]?.[2]?.querystring).toMatchObject({
      stage: 's3_technical_iteration',
    });
    expect(vi.mocked(downloadFromApi).mock.calls[0]?.[2]?.querystring).not.toHaveProperty(
      'pipelineStageId',
    );
  });
});

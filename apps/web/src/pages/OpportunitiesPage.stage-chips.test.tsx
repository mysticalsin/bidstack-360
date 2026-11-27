import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { OpportunitiesPage } from './OpportunitiesPage';
import { useOpportunities } from '@/hooks/useOpportunities';

// The default pipeline names the column Technical Iteration. OP-2041 stores
// s3_technical_iteration and leaves pipelineStageId empty. The list was also
// showing S3 Technical Iteration, so the demo chip looked like an empty stage.
const { TECHNICAL_ITERATION } = vi.hoisted(() => ({
  TECHNICAL_ITERATION: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
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
    error: null,
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

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
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

  it('shows the seeded bid on the demo stage, not a second empty chip', () => {
    vi.mocked(useOpportunities).mockReturnValue({
      data: { items: [seededBid()], nextCursor: null },
      isLoading: false,
      isError: false,
      error: null,
    } as ReturnType<typeof useOpportunities>);

    renderPage();

    const chips = screen.getByRole('group', { name: 'Filter opportunities by stage' });
    expect(within(chips).getByRole('button', { name: 'Technical Iteration' })).toBeTruthy();
    expect(within(chips).queryByRole('button', { name: 'S3 Technical Iteration' })).toBeNull();

    const table = screen.getByRole('table');
    const badge = within(table).getByText('Technical Iteration');
    expect(badge.className).toContain('tag-teal');
    expect(within(table).queryByText('S3 Technical Iteration')).toBeNull();

    fireEvent.click(within(chips).getByRole('button', { name: 'Technical Iteration' }));

    const lastCall = vi.mocked(useOpportunities).mock.calls.at(-1)?.[0];
    expect(lastCall).toMatchObject({ stage: 's3_technical_iteration' });
    expect(lastCall).not.toHaveProperty('pipelineStageId');
  });
});

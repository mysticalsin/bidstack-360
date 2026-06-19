import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { OpportunitiesPage } from './OpportunitiesPage';
import { useOpportunities } from '@/hooks/useOpportunities';

vi.mock('@/hooks/useOpportunities', () => ({
  useOpportunities: vi.fn(),
  usePatchOpportunity: vi.fn(() => ({ mutate: vi.fn() })),
  useCreateOpportunity: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

vi.mock('@/hooks/useStageMutation', () => ({
  useStageMutation: vi.fn(() => ({ mutateAsync: vi.fn() })),
}));

vi.mock('@/hooks/usePipelineStages', () => ({
  usePipelineStages: vi.fn(() => ({
    data: { items: [] },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  })),
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

vi.mock('@/hooks/useFormatMoney', () => ({
  useFormatMoney: () => ({
    currency: 'EUR',
    convert: (value: number) => value,
    formatMoney: (value: number) => `EUR ${value.toLocaleString('en-US')}`,
    formatMoneyMicros: (micros: string | number | bigint) =>
      `EUR ${(Number(micros) / 1_000_000).toLocaleString('en-US')}`,
  }),
}));

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

function mockOpportunities(value: Partial<ReturnType<typeof useOpportunities>>) {
  vi.mocked(useOpportunities).mockReturnValue(value as ReturnType<typeof useOpportunities>);
}

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('OpportunitiesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders a loading skeleton when data is loading', () => {
    mockOpportunities({
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
    });

    renderWithProviders(<OpportunitiesPage />);

    // The skeleton has no explicit role, but we can verify it doesn't render the table
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('renders the opportunities table with seeded data', () => {
    mockOpportunities({
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
    });

    renderWithProviders(<OpportunitiesPage />);

    expect(screen.getByRole('heading', { name: /Opportunities/i })).toBeTruthy();
    expect(screen.getByText('Acme Upgrade')).toBeTruthy();
    expect(screen.getByText('OP-0001')).toBeTruthy();
  });

  it('renders an empty state when no opportunities exist', () => {
    mockOpportunities({
      data: { items: [], nextCursor: null },
      isLoading: false,
      isError: false,
      error: null,
    });

    renderWithProviders(<OpportunitiesPage />);

    expect(screen.getByText('No opportunities yet')).toBeTruthy();
    expect(screen.getByText('Create your first opportunity to start tracking bids.')).toBeTruthy();
  });
});

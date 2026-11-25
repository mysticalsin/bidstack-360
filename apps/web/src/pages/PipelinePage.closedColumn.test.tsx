// Demo Closed Won and Closed Lost are real columns. A bid whose stage text
// is that title is not the enum. The board was opening a second column with
// the same title and leaving the demo column empty.
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { PipelinePage } from './PipelinePage';
import { useOpportunities } from '@/hooks/useOpportunities';
import { usePipelineStages } from '@/hooks/usePipelineStages';
import { useStageMutation } from '@/hooks/useStageMutation';
import type { Opportunity, PipelineStage } from '@bidstack/shared';

vi.mock('@/hooks/useOpportunities', () => ({ useOpportunities: vi.fn() }));
vi.mock('@/hooks/usePipelineReport', () => ({
  usePipelineReport: vi.fn(() => ({ data: undefined, isLoading: false, isError: false })),
}));
vi.mock('@/hooks/usePipelineStages', () => ({ usePipelineStages: vi.fn() }));
vi.mock('@/hooks/useStageMutation', () => ({ useStageMutation: vi.fn() }));
vi.mock('@/hooks/useCapabilities', () => ({ useHasPermission: () => true }));

const CLOSED_WON: PipelineStage = {
  id: '66666666-6666-4666-8666-666666666666',
  name: 'Closed Won',
  probability: 100,
  color: '#22c55e',
  isWon: true,
  isLost: false,
};

const CLOSED_LOST: PipelineStage = {
  id: '77777777-7777-4777-8777-777777777777',
  name: 'Closed Lost',
  probability: 0,
  color: '#ef4444',
  isWon: false,
  isLost: true,
};

function bid(partial: Partial<Opportunity> & Pick<Opportunity, 'id' | 'code' | 'customer' | 'name' | 'stage' | 'value'>): Opportunity {
  return {
    pipelineStageId: null,
    pipelineStage: null,
    probability: 0,
    dueDate: '2026-12-31',
    owner: null,
    industry: null,
    logo: null,
    country: null,
    territoryId: null,
    territoryName: null,
    updatedAt: '2026-06-01T00:00:00.000Z',
    taskCount: 0,
    commentCount: 0,
    viewCount: 0,
    ...partial,
  };
}

const STELLANTIS = bid({
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  code: 'OP-0005',
  customer: 'Stellantis',
  name: 'EV Fleet Telematics',
  stage: 'Closed Won',
  value: 620_000,
});

const SPOTIFY = bid({
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  code: 'OP-0006',
  customer: 'Spotify',
  name: 'Data Lakehouse Build',
  stage: 'Closed Lost',
  value: 430_000,
});

function column(name: string): HTMLElement {
  const match = screen
    .getAllByTestId('pipeline-column')
    .find((node) => node.getAttribute('data-stage-name') === name);
  if (!match) throw new Error(`missing column ${name}`);
  return match;
}

describe('PipelinePage closed columns', () => {
  afterEach(() => {
    vi.clearAllMocks();
    cleanup();
  });

  it('puts a titled closed bid in the demo column and does not open a second one', () => {
    vi.mocked(useOpportunities).mockReturnValue({
      data: { items: [STELLANTIS, SPOTIFY], nextCursor: null },
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useOpportunities>);
    vi.mocked(usePipelineStages).mockReturnValue({
      data: {
        items: [CLOSED_WON, CLOSED_LOST].map((stage, index) => ({
          ...stage,
          key: stage.isWon ? 'closed_won' : 'closed_lost',
          orderIndex: index,
          forecastCategory: stage.isWon ? 'closed_won' : 'closed_lost',
          updatedAt: '2026-06-01T00:00:00.000Z',
        })),
      },
      isLoading: false,
    } as unknown as ReturnType<typeof usePipelineStages>);
    vi.mocked(useStageMutation).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useStageMutation>);

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <PipelinePage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const names = screen.getAllByTestId('pipeline-column').map((node) => node.getAttribute('data-stage-name'));
    expect(names).toEqual(['Closed Won', 'Closed Lost']);

    const won = column('Closed Won');
    expect(won.getAttribute('data-stage-id')).toBe(CLOSED_WON.id);
    expect(within(won).getByText('Stellantis')).toBeTruthy();

    const lost = column('Closed Lost');
    expect(lost.getAttribute('data-stage-id')).toBe(CLOSED_LOST.id);
    expect(within(lost).getByText('Spotify')).toBeTruthy();
  });
});

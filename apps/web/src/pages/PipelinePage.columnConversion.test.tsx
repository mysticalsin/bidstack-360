// Demo S1 Lead is an empty first column. The chip beside it was
// "→ 100%" because every later bid counted as converted out of an empty
// stage. A loss in a later column must not count as that progress either.
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
  usePipelineReport: vi.fn(() => ({ data: undefined, isLoading: false })),
}));
vi.mock('@/hooks/usePipelineStages', () => ({ usePipelineStages: vi.fn() }));
vi.mock('@/hooks/useStageMutation', () => ({ useStageMutation: vi.fn() }));
vi.mock('@/hooks/useCapabilities', () => ({ useHasPermission: () => true }));

const LEAD: PipelineStage = {
  id: 's1_lead',
  name: 'S1 Lead',
  probability: 10,
  color: '#3b82f6',
  isWon: false,
  isLost: false,
};

const ONGOING: PipelineStage = {
  id: 's1_ongoing',
  name: 'S1 Ongoing',
  probability: 25,
  color: '#6366f1',
  isWon: false,
  isLost: false,
};

const LOST: PipelineStage = {
  id: 'closed_lost',
  name: 'Closed Lost',
  probability: 0,
  color: '#ef4444',
  isWon: false,
  isLost: true,
};

function opp(stage: PipelineStage, id: string, name: string): Opportunity {
  return {
    id,
    code: id,
    customer: 'Northwind Synthetic',
    name,
    stage: stage.id,
    pipelineStageId: stage.id,
    pipelineStage: stage,
    value: 320_000,
    probability: stage.probability,
    dueDate: '2026-08-15',
    owner: null,
    industry: null,
    logo: null,
    country: null,
    territoryId: null,
    territoryName: null,
    updatedAt: '2026-06-01T00:00:00.000Z',
    taskCount: 1,
    commentCount: 0,
    viewCount: 0,
  };
}

function renderBoard(
  items: Opportunity[],
  nextCursor: string | null = null,
  stages: PipelineStage[] = [LEAD, ONGOING, LOST],
) {
  vi.mocked(useOpportunities).mockReturnValue({
    data: { items, nextCursor },
    isLoading: false,
    isError: false,
    error: null,
  } as unknown as ReturnType<typeof useOpportunities>);
  vi.mocked(usePipelineStages).mockReturnValue({
    data: {
      items: stages.map((stage, index) => ({
        ...stage,
        key: stage.id,
        orderIndex: index,
        forecastCategory: stage.isLost ? 'closed_lost' : 'pipeline',
        updatedAt: '',
      })),
    },
    isLoading: false,
  } as unknown as ReturnType<typeof usePipelineStages>);
  vi.mocked(useStageMutation).mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof useStageMutation>);

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PipelinePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function column(name: RegExp) {
  return screen.getByRole('region', { name });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('deal board column conversion', () => {
  it('does not mark an empty lead column as 100% converted', () => {
    // WHY: the demo book starts at S1 Ongoing. S1 Lead is empty, and the
    // chip was reading the later bids as a perfect conversion out of it.
    // The loss sits later and is not progress, so Ongoing stays at 0%.
    renderBoard([
      opp(ONGOING, 'op-2042', 'Logistec Corporation — SOC 2 Readiness'),
      opp(LOST, 'op-2047', 'NOS — SOC build-out'),
    ]);

    expect(within(column(/S1 Lead column/)).queryByLabelText(/Conversion rate/)).toBeNull();
    expect(within(column(/S1 Ongoing column/)).getByLabelText('Conversion rate: 0%')).toBeTruthy();
    expect(within(column(/Closed Lost column/)).queryByLabelText(/Conversion rate/)).toBeNull();
    expect(screen.queryByLabelText('Conversion rate: 100%')).toBeNull();
  });

  it('hides the rate when the board page is not every bid', () => {
    renderBoard(
      [
        opp(ONGOING, 'op-2042', 'Logistec Corporation — SOC 2 Readiness'),
        opp(LEAD, 'op-lead', 'A lead still in S1'),
      ],
      'next',
    );

    expect(screen.queryByLabelText(/Conversion rate/)).toBeNull();
    expect(screen.getAllByText(/not every bid/).length).toBeGreaterThan(0);
  });

  it('does not count a lost stage that is not named Closed Lost as progress', () => {
    // WHY: a custom lost stage is still a loss. The old chip only skipped
    // the English name "Closed Lost", so a stage named Lost inflated the rate.
    const customLost: PipelineStage = { ...LOST, id: 'lost_custom', name: 'Lost' };
    renderBoard(
      [
        opp(ONGOING, 'op-2042', 'Logistec Corporation — SOC 2 Readiness'),
        opp(customLost, 'op-lost', 'A lost bid'),
      ],
      null,
      [LEAD, ONGOING, customLost],
    );

    expect(within(column(/S1 Ongoing column/)).getByLabelText('Conversion rate: 0%')).toBeTruthy();
    expect(within(column(/Lost column/)).queryByLabelText(/Conversion rate/)).toBeNull();
  });
});

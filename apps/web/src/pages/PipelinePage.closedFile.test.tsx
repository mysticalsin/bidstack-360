// A bid filed on Closed Won must show up in that column. The nested stage
// object is a copy of the previous column and can stay there after the id
// changes. Trusting the copy leaves Closed Won empty and keeps a decided
// bid on the open column, which reads as if the win never landed.
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import '@/i18n';

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

const NEGOTIATION: PipelineStage = {
  id: '55555555-5555-4555-8555-555555555555',
  name: 'Negotiation',
  probability: 80,
  color: '#f59e0b',
  isWon: false,
  isLost: false,
};

const CLOSED_WON: PipelineStage = {
  id: '66666666-6666-4666-8666-666666666666',
  name: 'Closed Won',
  probability: 100,
  color: '#22c55e',
  isWon: true,
  isLost: false,
};

function bid(partial: Partial<Opportunity> & Pick<Opportunity, 'id' | 'code' | 'customer' | 'name'>): Opportunity {
  return {
    stage: 's4_negotiation',
    pipelineStageId: NEGOTIATION.id,
    pipelineStage: NEGOTIATION,
    value: 100_000,
    probability: 40,
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
  // Filed on Closed Won. The nested copy still describes Negotiation.
  stage: 'Negotiation',
  pipelineStageId: CLOSED_WON.id,
  pipelineStage: NEGOTIATION,
  value: 620_000,
  probability: 100,
  owner: 'marco.bianchi.demo@example.test',
});

const IKEA = bid({
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  code: 'OP-0002',
  customer: 'IKEA',
  name: 'Cloud Migration & FinOps',
  stage: 's4_negotiation',
  pipelineStageId: NEGOTIATION.id,
  pipelineStage: NEGOTIATION,
  value: 850_000,
  probability: 75,
});

function column(name: string): HTMLElement {
  const match = screen
    .getAllByTestId('pipeline-column')
    .find((node) => node.getAttribute('data-stage-name') === name);
  if (!match) throw new Error(`missing column ${name}`);
  return match;
}

describe('PipelinePage filed closed column', () => {
  afterEach(() => {
    vi.clearAllMocks();
    cleanup();
  });

  it('draws a bid in Closed Won when that column id is saved and the stage copy is still the previous column', () => {
    vi.mocked(useOpportunities).mockReturnValue({
      data: { items: [STELLANTIS, IKEA], nextCursor: null },
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useOpportunities>);
    vi.mocked(usePipelineStages).mockReturnValue({
      data: {
        items: [
          { ...NEGOTIATION, key: 's4_negotiation', orderIndex: 4, forecastCategory: 'commit', updatedAt: '2026-06-01T00:00:00.000Z' },
          { ...CLOSED_WON, key: 'closed_won', orderIndex: 5, forecastCategory: 'closed_won', updatedAt: '2026-06-01T00:00:00.000Z' },
        ],
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

    const won = column('Closed Won');
    expect(won.getAttribute('data-stage-id')).toBe(CLOSED_WON.id);
    expect(within(won).getByText('Stellantis')).toBeTruthy();
    // The card is in the won column, so its name has to say so. The stale
    // copy would announce Negotiation and the won column would look empty.
    expect(within(won).getByRole('link').getAttribute('aria-label')).toContain('Closed Won');

    const negotiation = column('Negotiation');
    expect(within(negotiation).queryByText('Stellantis')).toBeNull();
    expect(within(negotiation).getByText('IKEA')).toBeTruthy();
  });
});

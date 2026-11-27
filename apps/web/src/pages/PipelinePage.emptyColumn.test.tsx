// Demo Lead (and any other stage with no loaded bid) painted "Drop here" and
// nothing else. A viewer cannot drop. A finished page really is empty. A
// continued page is not the whole stage.
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

const capabilitiesMocks = vi.hoisted(() => ({ useHasPermission: vi.fn(() => true) }));
vi.mock('@/hooks/useCapabilities', () => capabilitiesMocks);

const LEAD: PipelineStage = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Lead',
  probability: 10,
  color: '#94a3b8',
  isWon: false,
  isLost: false,
};

const ONGOING: PipelineStage = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Ongoing',
  probability: 25,
  color: '#6366f1',
  isWon: false,
  isLost: false,
};

const BID: Opportunity = {
  id: '33333333-3333-4333-8333-333333333333',
  code: 'OP-2042',
  customer: 'Logistec Corporation',
  name: 'Logistec Corporation — SOC 2 Readiness',
  stage: ONGOING.name,
  pipelineStageId: ONGOING.id,
  pipelineStage: ONGOING,
  value: 320_000,
  probability: 35,
  dueDate: '2026-08-15',
  owner: null,
  industry: 'transportation',
  logo: null,
  country: 'CA',
  territoryId: null,
  territoryName: null,
  updatedAt: '2026-06-01T00:00:00.000Z',
  taskCount: 0,
  commentCount: 0,
  viewCount: 0,
};

function renderBoard(canWrite: boolean, nextCursor: string | null = null) {
  capabilitiesMocks.useHasPermission.mockReturnValue(canWrite);
  vi.mocked(useOpportunities).mockReturnValue({
    data: { items: [BID], nextCursor },
    isLoading: false,
    isError: false,
    error: null,
  } as unknown as ReturnType<typeof useOpportunities>);
  vi.mocked(usePipelineStages).mockReturnValue({
    data: {
      items: [LEAD, ONGOING].map((stage, index) => ({
        ...stage,
        key: stage.id,
        orderIndex: index,
        forecastCategory: 'pipeline',
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

function leadColumn() {
  return screen.getByRole('region', { name: /Lead column/ });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('deal board empty column', () => {
  it('says the demo Lead column has no bids and still offers a drop to a writer', () => {
    renderBoard(true);

    const column = leadColumn();
    expect(within(column).getByText('No bids')).toBeTruthy();
    expect(within(column).getByText('Drop one here')).toBeTruthy();
    expect(within(column).queryByText('Drop here')).toBeNull();
    expect(screen.getByText(/Drag a card between columns/)).toBeTruthy();
  });

  it('does not tell a viewer to drop a bid into the empty column', () => {
    // WHY: opportunities:write is what makes a drop stick. The empty Lead
    // column was still the only control that said "Drop here".
    renderBoard(false);

    const column = leadColumn();
    expect(within(column).getByText('No bids')).toBeTruthy();
    expect(within(column).queryByText(/Drop/)).toBeNull();
    expect(screen.queryByText(/Drag a card between columns/)).toBeNull();
    expect(screen.getByText(/Moving a stage needs permission/)).toBeTruthy();
  });

  it('does not call Lead empty when the board page is not every bid', () => {
    renderBoard(true, 'next');

    const column = leadColumn();
    expect(within(column).getByText('None in the latest bids')).toBeTruthy();
    expect(within(column).queryByText('No bids')).toBeNull();
    expect(within(column).getByText('Drop one here')).toBeTruthy();
  });
});

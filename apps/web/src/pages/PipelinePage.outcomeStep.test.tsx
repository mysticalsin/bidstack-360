// Demo Closed Won sits in the column immediately left of Closed Lost.
// Stellantis is the win and Spotify is the loss. The header tells a reader
// to focus a card and press an arrow to move stages. That arrow treated the
// other outcome as the next stage, so the win became a loss and the loss
// became a win. A drop on the other outcome column did the same.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { PipelinePage } from './PipelinePage';
import { toast } from '@/components/ui/Toast';
import { useOpportunities } from '@/hooks/useOpportunities';
import { usePipelineStages } from '@/hooks/usePipelineStages';
import { useStageMutation } from '@/hooks/useStageMutation';
import type { Opportunity, PipelineStage } from '@bidstack/shared';

vi.mock('@/hooks/useOpportunities', () => ({
  useOpportunities: vi.fn(),
}));

vi.mock('@/hooks/usePipelineReport', () => ({
  usePipelineReport: vi.fn(() => ({ data: undefined, isLoading: false })),
}));

vi.mock('@/hooks/usePipelineStages', () => ({
  usePipelineStages: vi.fn(),
}));

vi.mock('@/hooks/useStageMutation', () => ({
  useStageMutation: vi.fn(),
}));

vi.mock('@/components/ui/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/hooks/useCapabilities', () => ({
  useHasPermission: vi.fn(() => true),
}));

const NEGOTIATION: PipelineStage = {
  id: '55555555-5555-4555-8555-555555555555',
  name: 'Negotiation',
  probability: 80,
  color: '#f59e0b',
  isWon: false,
  isLost: false,
};
const WON: PipelineStage = {
  id: '66666666-6666-4666-8666-666666666666',
  name: 'Closed Won',
  probability: 100,
  color: '#22c55e',
  isWon: true,
  isLost: false,
};
const LOST: PipelineStage = {
  id: '77777777-7777-4777-8777-777777777777',
  name: 'Closed Lost',
  probability: 0,
  color: '#ef4444',
  isWon: false,
  isLost: true,
};

function bid(stage: PipelineStage, customer: string, name: string, code: string): Opportunity {
  return {
    id: `88888888-8888-4888-8888-${code.slice(-4).padStart(12, '0')}`,
    code,
    customer,
    name,
    stage: stage.isWon ? 'closed_won' : stage.isLost ? 'closed_lost' : 's4_negotiation',
    pipelineStageId: stage.id,
    pipelineStage: stage,
    value: 620_000,
    probability: stage.probability,
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
  };
}

const IKEA = bid(NEGOTIATION, 'IKEA', 'Cloud Migration & FinOps', 'OP-0002');
const STELLANTIS = bid(WON, 'Stellantis', 'EV Fleet Telematics', 'OP-0005');
const SPOTIFY = bid(LOST, 'Spotify', 'Data Lakehouse Build', 'OP-0006');

function renderBoard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <PipelinePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function cardFor(customer: string): HTMLElement {
  const node = screen.getByText(customer).closest('[data-testid="pipeline-card"]');
  if (!node) throw new Error(`missing card for ${customer}`);
  return node as HTMLElement;
}

describe('deal board outcome columns', () => {
  const mutate = vi.fn();

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  function loadDemo() {
    vi.mocked(useOpportunities).mockReturnValue({
      data: { items: [IKEA, STELLANTIS, SPOTIFY], nextCursor: null },
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useOpportunities>);
    vi.mocked(usePipelineStages).mockReturnValue({
      data: {
        items: [NEGOTIATION, WON, LOST].map((stage, index) => ({
          ...stage,
          key: stage.id,
          orderIndex: index,
          forecastCategory: '',
          updatedAt: '',
        })),
      },
      isLoading: false,
    } as unknown as ReturnType<typeof usePipelineStages>);
    vi.mocked(useStageMutation).mockReturnValue({
      mutate,
      isPending: false,
    } as unknown as ReturnType<typeof useStageMutation>);
  }

  it('does not file Stellantis as lost when the right arrow leaves Closed Won', () => {
    // WHY: the win is already decided. The next painted column is Closed Lost.
    // The arrow is the keyboard path the header offers, and it must leave the
    // win in Closed Won.
    loadDemo();
    renderBoard();

    fireEvent.keyDown(cardFor('Stellantis'), { key: 'ArrowRight' });

    expect(mutate).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      'Won and lost stay separate',
      expect.objectContaining({
        description: 'Move the bid to an open stage to reopen it.',
      }),
    );
    expect(
      screen.getByText('Stellantis').closest('[data-stage-id]')?.getAttribute('data-stage-id'),
    ).toBe(WON.id);
  });

  it('does not file Spotify as won when the left arrow leaves Closed Lost', () => {
    // WHY: the previous painted column is Closed Won. A loss must stay a loss
    // when the reader asks for the previous stage.
    loadDemo();
    renderBoard();

    fireEvent.keyDown(cardFor('Spotify'), { key: 'ArrowLeft' });

    expect(mutate).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('Won and lost stay separate', expect.anything());
  });

  it('does not file Stellantis as lost when the card is dropped on Closed Lost', () => {
    // WHY: a drop on the neighbouring outcome column is the same mis-file as
    // the arrow. Reopening still targets an open stage.
    loadDemo();
    renderBoard();

    const lost = screen
      .getByRole('region', { name: /Closed Lost column with 1 opportunity/i })
      .querySelector('[data-testid="pipeline-column-dropzone"]');
    if (!lost) throw new Error('missing Closed Lost drop zone');
    fireEvent.drop(lost, { dataTransfer: { getData: () => STELLANTIS.id } });

    expect(mutate).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('Won and lost stay separate', expect.anything());
  });

  it('still moves IKEA from Negotiation into Closed Won', () => {
    // WHY: the arrow still closes an open bid. The guard is only the swap
    // between the two outcome columns.
    loadDemo();
    renderBoard();

    fireEvent.keyDown(cardFor('IKEA'), { key: 'ArrowRight' });

    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ id: IKEA.id, pipelineStageId: WON.id }),
      expect.anything(),
    );
  });
});

// A stage filter shared with the opportunities list can be the demo stage key
// (s3_technical_iteration) while the board column id is the stage uuid.
// That filter has to open Technical Iteration. A value that names nothing
// has to say so. It must not look like an empty book.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import '@/i18n';
import { PipelinePage } from './PipelinePage';
import { useOpportunities } from '@/hooks/useOpportunities';
import { usePipelineStages } from '@/hooks/usePipelineStages';
import { useStageMutation } from '@/hooks/useStageMutation';
import type { Opportunity, PipelineStage } from '@bidstack/shared';

vi.mock('@/hooks/useOpportunities', () => ({
  useOpportunities: vi.fn(),
}));

vi.mock('@/hooks/usePipelineReport', () => ({
  usePipelineReport: vi.fn(() => ({ data: undefined, isLoading: false, isError: false })),
}));

vi.mock('@/hooks/usePipelineStages', () => ({
  usePipelineStages: vi.fn(),
}));

vi.mock('@/hooks/useStageMutation', () => ({
  useStageMutation: vi.fn(),
}));

vi.mock('@/hooks/useCapabilities', () => ({
  useHasPermission: vi.fn(() => true),
}));

const TECHNICAL: PipelineStage & { key: string } = {
  id: '44444444-4444-4444-8444-444444444444',
  key: 's3_technical_iteration',
  name: 'Technical Iteration',
  probability: 65,
  color: '#06b6d4',
  isWon: false,
  isLost: false,
};

const NEGOTIATION: PipelineStage & { key: string } = {
  id: '55555555-5555-4555-8555-555555555555',
  key: 's4_negotiation',
  name: 'Negotiation',
  probability: 80,
  color: '#f59e0b',
  isWon: false,
  isLost: false,
};

function bid(partial: Partial<Opportunity> & Pick<Opportunity, 'id' | 'customer' | 'stage'>): Opportunity {
  return {
    code: 'OP-0001',
    name: 'Global ERP Modernization',
    pipelineStageId: null,
    pipelineStage: null,
    value: 1_200_000,
    probability: 60,
    dueDate: null,
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

const LINKED_SIEMENS = bid({
  id: '88888888-8888-4888-8888-888888888888',
  customer: 'Siemens',
  stage: 'Technical Iteration',
  pipelineStageId: TECHNICAL.id,
  pipelineStage: {
    id: TECHNICAL.id,
    name: TECHNICAL.name,
    probability: TECHNICAL.probability,
    color: TECHNICAL.color,
    isWon: false,
    isLost: false,
  },
});

const ENUM_SIEMENS = bid({
  id: '88888888-8888-4888-8888-888888888888',
  customer: 'Siemens',
  stage: 's3_technical_iteration',
});

function renderBoard(filter: string, items: Opportunity[]) {
  vi.mocked(useOpportunities).mockReturnValue({
    data: { items, nextCursor: null },
    isLoading: false,
    isError: false,
    error: null,
  } as unknown as ReturnType<typeof useOpportunities>);

  vi.mocked(usePipelineStages).mockReturnValue({
    data: {
      items: [TECHNICAL, NEGOTIATION].map((stage, index) => ({
        ...stage,
        orderIndex: index,
        forecastCategory: 'pipeline',
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
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/pipeline?pipelineStageId=${filter}`]}>
        <PipelinePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PipelinePage stage filter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('opens Technical Iteration when the filter is the demo stage key and the bid is already on that column', () => {
    renderBoard('s3_technical_iteration', [LINKED_SIEMENS]);

    const column = screen.getByRole('region', {
      name: 'Technical Iteration column with 1 opportunity',
    });
    expect(column.getAttribute('data-stage-id')).toBe(TECHNICAL.id);
    expect(screen.getByText('Siemens')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('1 opportunity · Technical Iteration');
    expect(screen.queryByText('No opportunities yet')).toBeNull();
    expect((screen.getByLabelText('Filter pipeline by stage') as HTMLSelectElement).value).toBe(
      TECHNICAL.id,
    );
  });

  it('says the stage is not on the board when the filter matches no column', () => {
    renderBoard('00000000-0000-4000-8000-000000000099', [LINKED_SIEMENS]);

    expect(screen.getByRole('heading', { name: 'This stage is not on the board' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('This stage is not on the board');
    expect(screen.queryByText('No opportunities yet')).toBeNull();
    expect(screen.queryByTestId('pipeline-column')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Clear stage filter' }));

    expect(screen.getByText('Siemens')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'This stage is not on the board' })).toBeNull();
  });

  it('keeps an enum-only bid on the column whose id is the legacy key', () => {
    renderBoard('s3_technical_iteration', [ENUM_SIEMENS]);

    expect(screen.getByText('Siemens')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'This stage is not on the board' })).toBeNull();
  });
});

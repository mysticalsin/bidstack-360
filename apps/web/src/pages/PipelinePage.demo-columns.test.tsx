// The demo pipeline names columns Lead, Ongoing, Proposal Sent, Technical
// Iteration, Negotiation, Closed Won, and Closed Lost. Seeded bids such as
// Siemens keep the legacy enum and no pipeline stage row. The board has to
// draw that bid in Technical Iteration. A second column named S3 Technical
// Iteration leaves the real column empty.
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

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

interface DemoStage extends PipelineStage {
  key: string;
}

const DEMO_STAGES: DemoStage[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    key: 's1_lead',
    name: 'Lead',
    probability: 10,
    color: '#6366f1',
    isWon: false,
    isLost: false,
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    key: 's1_ongoing',
    name: 'Ongoing',
    probability: 30,
    color: '#8b5cf6',
    isWon: false,
    isLost: false,
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    key: 's2_sent',
    name: 'Proposal Sent',
    probability: 50,
    color: '#0ea5e9',
    isWon: false,
    isLost: false,
  },
  {
    id: '44444444-4444-4444-8444-444444444444',
    key: 's3_technical_iteration',
    name: 'Technical Iteration',
    probability: 65,
    color: '#06b6d4',
    isWon: false,
    isLost: false,
  },
  {
    id: '55555555-5555-4555-8555-555555555555',
    key: 's4_negotiation',
    name: 'Negotiation',
    probability: 80,
    color: '#f59e0b',
    isWon: false,
    isLost: false,
  },
  {
    id: '66666666-6666-4666-8666-666666666666',
    key: 'closed_won',
    name: 'Closed Won',
    probability: 100,
    color: '#22c55e',
    isWon: true,
    isLost: false,
  },
  {
    id: '77777777-7777-4777-8777-777777777777',
    key: 'closed_lost',
    name: 'Closed Lost',
    probability: 0,
    color: '#ef4444',
    isWon: false,
    isLost: true,
  },
];

function stageByKey(key: string): DemoStage {
  const stage = DEMO_STAGES.find((item) => item.key === key);
  if (!stage) throw new Error(`missing demo stage ${key}`);
  return stage;
}

function bid(
  partial: Pick<Opportunity, 'id' | 'code' | 'customer' | 'name' | 'stage' | 'value'> &
    Partial<Opportunity>,
): Opportunity {
  return {
    pipelineStageId: null,
    pipelineStage: null,
    probability: 40,
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

const SIEMENS = bid({
  id: '88888888-8888-4888-8888-888888888888',
  code: 'OP-0001',
  customer: 'Siemens',
  name: 'Global ERP Modernization',
  stage: 's3_technical_iteration',
  value: 1_200_000,
});

const NEGOTIATION = stageByKey('s4_negotiation');
const IKEA = bid({
  id: '99999999-9999-4999-8999-999999999999',
  code: 'OP-0002',
  customer: 'IKEA',
  name: 'Cloud Migration & FinOps',
  stage: 'Negotiation',
  pipelineStageId: NEGOTIATION.id,
  pipelineStage: {
    id: NEGOTIATION.id,
    name: NEGOTIATION.name,
    probability: NEGOTIATION.probability,
    color: NEGOTIATION.color,
    isWon: false,
    isLost: false,
  },
  value: 850_000,
});

const STELLANTIS = bid({
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  code: 'OP-0005',
  customer: 'Stellantis',
  name: 'EV Fleet Telematics',
  stage: 'closed_won',
  value: 620_000,
});

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <PipelinePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function column(name: string): HTMLElement {
  const match = screen
    .getAllByTestId('pipeline-column')
    .find((node) => node.getAttribute('data-stage-name') === name);
  if (!match) throw new Error(`missing column ${name}`);
  return match;
}

describe('PipelinePage demo columns', () => {
  beforeEach(() => {
    vi.mocked(useOpportunities).mockReturnValue({
      data: { items: [SIEMENS, IKEA, STELLANTIS], nextCursor: null },
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useOpportunities>);

    vi.mocked(usePipelineStages).mockReturnValue({
      data: {
        items: DEMO_STAGES.map((stage, index) => ({
          ...stage,
          orderIndex: index,
          forecastCategory: stage.isWon ? 'closed_won' : stage.isLost ? 'closed_lost' : 'pipeline',
          updatedAt: '2026-06-01T00:00:00.000Z',
        })),
      },
      isLoading: false,
    } as unknown as ReturnType<typeof usePipelineStages>);

    vi.mocked(useStageMutation).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useStageMutation>);
  });

  afterEach(() => {
    vi.clearAllMocks();
    cleanup();
  });

  it('puts the seeded enum bid in Technical Iteration and leaves Lead empty', () => {
    renderPage();

    const names = screen
      .getAllByTestId('pipeline-column')
      .map((node) => node.getAttribute('data-stage-name'));
    expect(names).toEqual([
      'Lead',
      'Ongoing',
      'Proposal Sent',
      'Technical Iteration',
      'Negotiation',
      'Closed Won',
      'Closed Lost',
    ]);

    const technical = column('Technical Iteration');
    expect(technical.getAttribute('data-stage-id')).toBe(stageByKey('s3_technical_iteration').id);
    expect(within(technical).getByText('Siemens')).toBeTruthy();
    expect(within(technical).queryByText('S3 Technical Iteration')).toBeNull();

    expect(within(column('Negotiation')).getByText('IKEA')).toBeTruthy();
    expect(within(column('Closed Won')).getByText('Stellantis')).toBeTruthy();
    expect(within(column('Lead')).queryByTestId('pipeline-card')).toBeNull();
    expect(screen.queryByText('S3 Technical Iteration')).toBeNull();
    expect(screen.queryByText('S1 Lead')).toBeNull();
  });
});

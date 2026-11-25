// The conversion chip is a whole-board rate. A stage filter hides the other
// columns, so that rate is no longer about the column on screen. Demo
// Negotiation is IKEA alone. The 50% chip counts Stellantis in Closed Won,
// which the filter has hidden. Leaving the chip up reads as IKEA's chance.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { PipelinePage } from './PipelinePage';
import { useOpportunities } from '@/hooks/useOpportunities';
import { usePipelineStages } from '@/hooks/usePipelineStages';
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
  useStageMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

vi.mock('@/hooks/useCapabilities', () => ({
  useHasPermission: vi.fn(() => true),
}));

const LEAD: PipelineStage = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Lead',
  probability: 10,
  color: '#6366f1',
  isWon: false,
  isLost: false,
};
const ONGOING: PipelineStage = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Ongoing',
  probability: 30,
  color: '#8b5cf6',
  isWon: false,
  isLost: false,
};
const PROPOSAL: PipelineStage = {
  id: '33333333-3333-4333-8333-333333333333',
  name: 'Proposal Sent',
  probability: 50,
  color: '#0ea5e9',
  isWon: false,
  isLost: false,
};
const TECHNICAL: PipelineStage = {
  id: '44444444-4444-4444-8444-444444444444',
  name: 'Technical Iteration',
  probability: 65,
  color: '#06b6d4',
  isWon: false,
  isLost: false,
};
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

const COLUMNS = [LEAD, ONGOING, PROPOSAL, TECHNICAL, NEGOTIATION, WON, LOST];

function bid(stage: PipelineStage, customer: string, name: string, value: number): Opportunity {
  return {
    id: `88888888-8888-4888-8888-${customer.toLowerCase().padEnd(12, '0').slice(0, 12)}`,
    code: `OP-${customer.slice(0, 4).toUpperCase()}`,
    customer,
    name,
    stage: stage.name,
    pipelineStageId: stage.id,
    pipelineStage: stage,
    value,
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

const DEMO_BIDS: Opportunity[] = [
  bid(TECHNICAL, 'Siemens', 'Global ERP Modernization', 1_200_000),
  bid(NEGOTIATION, 'IKEA', 'Cloud Migration & FinOps', 850_000),
  bid(PROPOSAL, 'Sanofi', 'Patient Data Platform', 2_400_000),
  bid(ONGOING, 'HSBC', 'Cybersecurity Transformation', 1_750_000),
  bid(WON, 'Stellantis', 'EV Fleet Telematics', 620_000),
  bid(LOST, 'Spotify', 'Data Lakehouse Build', 430_000),
];

function renderBoard(filter: string | null) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const path = filter ? `/pipeline?pipelineStageId=${filter}` : '/pipeline';
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <PipelinePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('deal board conversion chip under a stage filter', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  function loadDemo() {
    vi.mocked(useOpportunities).mockReturnValue({
      data: { items: DEMO_BIDS, nextCursor: null },
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useOpportunities>);
    vi.mocked(usePipelineStages).mockReturnValue({
      data: {
        items: COLUMNS.map((stage, index) => ({
          ...stage,
          key: stage.id,
          orderIndex: index,
          forecastCategory: '',
          updatedAt: '',
        })),
      },
      isLoading: false,
    } as unknown as ReturnType<typeof usePipelineStages>);
  }

  it('drops the whole-board rate when Negotiation is the only column on screen', () => {
    // WHY: the 50% chip is Stellantis (hidden in Closed Won) over IKEA plus
    // that win. The filter already removed Stellantis. The chip would name a
    // chance the focused column does not show. IKEA stays. The stage control
    // still says Negotiation.
    loadDemo();
    renderBoard(NEGOTIATION.id);

    expect(screen.getByText('IKEA')).toBeTruthy();
    expect(screen.queryByText('Stellantis')).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Filter pipeline by stage' })).toHaveProperty(
      'value',
      NEGOTIATION.id,
    );
    expect(screen.queryByLabelText('Conversion rate: 50%')).toBeNull();
  });

  it('keeps the snapshot rate when every column is on screen', () => {
    // WHY: the rate is meaningful only while the columns it counts are
    // visible. Hiding it on the full board would drop a figure the open
    // column is allowed to show.
    loadDemo();
    renderBoard(null);

    expect(screen.getByText('IKEA')).toBeTruthy();
    expect(screen.getByText('Stellantis')).toBeTruthy();
    expect(screen.getByLabelText('Conversion rate: 50%')).toBeTruthy();
  });
});

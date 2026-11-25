// Demo columns are titled Lead, Ongoing, Proposal Sent, Technical Iteration,
// and Negotiation. A bid can carry that title and no stage row. The board
// was opening a second column with the same title and leaving the real
// column empty, so Sanofi looked unfiled.
import '@/i18n';

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

const LEAD = '11111111-1111-4111-8111-111111111111';
const ONGOING = '22222222-2222-4222-8222-222222222222';
const PROPOSAL_SENT = '33333333-3333-4333-8333-333333333333';
const TECHNICAL = '44444444-4444-4444-8444-444444444444';
const NEGOTIATION = '55555555-5555-4555-8555-555555555555';
const CLOSED_WON = '66666666-6666-4666-8666-666666666666';
const CLOSED_LOST = '77777777-7777-4777-8777-777777777777';

function columnStage(
  id: string,
  name: string,
  orderIndex: number,
  extras: Partial<PipelineStage> = {},
): PipelineStage & { key: string; orderIndex: number; forecastCategory: string; updatedAt: string } {
  return {
    id,
    name,
    probability: 40,
    color: null,
    isWon: false,
    isLost: false,
    key: id,
    orderIndex,
    forecastCategory: 'pipeline',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...extras,
  };
}

const DEMO_STAGES = [
  columnStage(LEAD, 'Lead', 0, { probability: 10 }),
  columnStage(ONGOING, 'Ongoing', 1, { probability: 30 }),
  columnStage(PROPOSAL_SENT, 'Proposal Sent', 2, { probability: 50 }),
  columnStage(TECHNICAL, 'Technical Iteration', 3, { probability: 65 }),
  columnStage(NEGOTIATION, 'Negotiation', 4, { probability: 80 }),
  columnStage(CLOSED_WON, 'Closed Won', 5, { probability: 100, isWon: true }),
  columnStage(CLOSED_LOST, 'Closed Lost', 6, { probability: 0, isLost: true }),
];

function bid(
  partial: Partial<Opportunity> & Pick<Opportunity, 'id' | 'code' | 'customer' | 'name' | 'stage' | 'value' | 'probability'>,
): Opportunity {
  return {
    pipelineStageId: null,
    pipelineStage: null,
    dueDate: '2099-12-31',
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

const HSBC = bid({
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  code: 'OP-0004',
  customer: 'HSBC',
  name: 'Cybersecurity Transformation',
  stage: 'Ongoing',
  value: 1_750_000,
  probability: 25,
});

const SANOFI = bid({
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
  code: 'OP-0003',
  customer: 'Sanofi',
  name: 'Patient Data Platform',
  stage: 'Proposal Sent',
  value: 2_400_000,
  probability: 40,
});

const SIEMENS = bid({
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
  code: 'OP-0001',
  customer: 'Siemens',
  name: 'Global ERP Modernization',
  stage: 'Technical Iteration',
  value: 1_200_000,
  probability: 60,
});

const IKEA = bid({
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4',
  code: 'OP-0002',
  customer: 'IKEA',
  name: 'Cloud Migration & FinOps',
  stage: 'Negotiation',
  value: 850_000,
  probability: 75,
});

const STELLANTIS = bid({
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5',
  code: 'OP-0005',
  customer: 'Stellantis',
  name: 'EV Fleet Telematics',
  stage: 'closed_won',
  value: 620_000,
  probability: 100,
});

const SPOTIFY = bid({
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6',
  code: 'OP-0006',
  customer: 'Spotify',
  name: 'Data Lakehouse Build',
  stage: 'closed_lost',
  value: 430_000,
  probability: 0,
});

function columnsNamed(name: string): HTMLElement[] {
  return screen.getAllByTestId('pipeline-column').filter((node) => node.getAttribute('data-stage-name') === name);
}

describe('PipelinePage demo stage titles', () => {
  afterEach(() => {
    vi.clearAllMocks();
    cleanup();
  });

  it('files a demo title on the one column of that name', () => {
    // WHY: Sanofi's stage text is "Proposal Sent", the demo column title.
    // That is not the legacy label "S2 Sent" and not the enum s2_sent.
    // A second Proposal Sent column leaves the real column empty ("Drop here")
    // and the bid looks unfiled. IKEA, Siemens, and HSBC are the same shape.
    vi.mocked(useOpportunities).mockReturnValue({
      data: { items: [HSBC, SANOFI, SIEMENS, IKEA, STELLANTIS, SPOTIFY], nextCursor: null },
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useOpportunities>);
    vi.mocked(usePipelineStages).mockReturnValue({
      data: { items: DEMO_STAGES },
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

    expect(columnsNamed('Proposal Sent')).toHaveLength(1);
    const proposal = columnsNamed('Proposal Sent')[0]!;
    expect(proposal.getAttribute('data-stage-id')).toBe(PROPOSAL_SENT);
    expect(within(proposal).getByText('Sanofi')).toBeTruthy();
    expect(within(proposal).queryByText('Drop here')).toBeNull();
    expect(within(proposal).getByRole('link').getAttribute('aria-label')).toContain('Proposal Sent');

    expect(columnsNamed('Ongoing')).toHaveLength(1);
    expect(within(columnsNamed('Ongoing')[0]!).getByText('HSBC')).toBeTruthy();
    expect(columnsNamed('Technical Iteration')).toHaveLength(1);
    expect(within(columnsNamed('Technical Iteration')[0]!).getByText('Siemens')).toBeTruthy();
    expect(columnsNamed('Negotiation')).toHaveLength(1);
    expect(within(columnsNamed('Negotiation')[0]!).getByText('IKEA')).toBeTruthy();

    expect(columnsNamed('Lead')).toHaveLength(1);
    expect(within(columnsNamed('Lead')[0]!).getByText('Drop here')).toBeTruthy();

    expect(columnsNamed('Closed Won')).toHaveLength(1);
    expect(within(columnsNamed('Closed Won')[0]!).getByText('Stellantis')).toBeTruthy();
    expect(columnsNamed('Closed Lost')).toHaveLength(1);
    expect(within(columnsNamed('Closed Lost')[0]!).getByText('Spotify')).toBeTruthy();
    expect(columnsNamed('S2 Sent')).toHaveLength(0);
    expect(columnsNamed('S4 Negotiation')).toHaveLength(0);
  });
});

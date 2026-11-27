// The percent beside a deal-board column was a funnel ratio: later cards
// that are not losses, divided by this column plus those cards. On the demo
// book that prints 50% on Negotiation, where IKEA is 75% and the stage
// default is 80%. Proposal Sent prints 75%, which is IKEA's chance, while
// Sanofi is 40%. The chip has to be the win probability of the bids in the
// column. An empty Lead has no bid, so it has no probability. A page that
// continues is not the whole column, so it does not state one either.
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
  usePipelineReport: vi.fn(() => ({ data: undefined, isLoading: false })),
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

interface DemoStage {
  id: string;
  name: string;
  probability: number;
  isWon?: boolean;
  isLost?: boolean;
}

const DEMO_STAGES: DemoStage[] = [
  { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', name: 'Lead', probability: 10 },
  { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', name: 'Ongoing', probability: 30 },
  { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', name: 'Proposal Sent', probability: 50 },
  { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4', name: 'Technical Iteration', probability: 65 },
  { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5', name: 'Negotiation', probability: 80 },
  {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6',
    name: 'Closed Won',
    probability: 100,
    isWon: true,
  },
  {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7',
    name: 'Closed Lost',
    probability: 0,
    isLost: true,
  },
];

function stage(name: string): PipelineStage {
  const found = DEMO_STAGES.find((item) => item.name === name);
  if (!found) throw new Error(`missing demo stage ${name}`);
  return {
    id: found.id,
    name: found.name,
    probability: found.probability,
    color: null,
    isWon: found.isWon ?? false,
    isLost: found.isLost ?? false,
  };
}

function bid(
  code: string,
  customer: string,
  name: string,
  stageName: string,
  value: number,
  probability: number,
): Opportunity {
  const pipelineStage = stage(stageName);
  return {
    id: `bbbbbbbb-bbbb-4bbb-8bbb-${code.replace(/\D/g, '').padStart(12, '0')}`,
    code,
    customer,
    name,
    stage: stageName,
    pipelineStageId: pipelineStage.id,
    pipelineStage,
    value,
    probability,
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
  };
}

const DEMO_BIDS: Opportunity[] = [
  bid('OP-0004', 'HSBC', 'Cybersecurity Transformation', 'Ongoing', 1_750_000, 25),
  bid('OP-0003', 'Sanofi', 'Patient Data Platform', 'Proposal Sent', 2_400_000, 40),
  bid('OP-0001', 'Siemens', 'Global ERP Modernization', 'Technical Iteration', 1_200_000, 60),
  bid('OP-0002', 'IKEA', 'Cloud Migration & FinOps', 'Negotiation', 850_000, 75),
  bid('OP-0005', 'Stellantis', 'EV Fleet Telematics', 'Closed Won', 620_000, 100),
  bid('OP-0006', 'Spotify', 'Data Lakehouse Build', 'Closed Lost', 430_000, 0),
];

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

function renderBoard(nextCursor: string | null = null) {
  vi.mocked(useOpportunities).mockReturnValue({
    data: { items: DEMO_BIDS, nextCursor },
    isLoading: false,
    isError: false,
    error: null,
  } as unknown as ReturnType<typeof useOpportunities>);
  vi.mocked(usePipelineStages).mockReturnValue({
    data: {
      items: DEMO_STAGES.map((item, index) => ({
        ...stage(item.name),
        key: item.id,
        orderIndex: index,
        forecastCategory: '',
        updatedAt: '',
      })),
    },
    isLoading: false,
  } as unknown as ReturnType<typeof usePipelineStages>);
  vi.mocked(useStageMutation).mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof useStageMutation>);

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <PipelinePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function column(name: string) {
  return screen.getByRole('region', { name: new RegExp(`^${name} column`) });
}

describe('deal board column win probability', () => {
  beforeEach(() => {
    renderBoard();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('prints the bid probability on Negotiation, not the 50% funnel or the 80% stage default', () => {
    // IKEA is the only Negotiation bid and is stored at 75. The stage default
    // is 80. The funnel counts Stellantis over IKEA plus Stellantis and
    // prints 50. A reader treats that percent as the chance of winning IKEA.
    const negotiation = column('Negotiation');
    expect(within(negotiation).getByText('75% probability')).toBeTruthy();
    const text = negotiation.textContent?.replace(/\s+/g, '') ?? '';
    expect(text).not.toContain('50%');
    expect(text).not.toContain('80%');
    expect(text).not.toContain('→');
    expect(within(negotiation).queryByLabelText(/Conversion rate/)).toBeNull();
  });

  it('keeps each open demo bid on its own probability', () => {
    // Ongoing's funnel is 80, which is Negotiation's stage default, while
    // HSBC is 25. Proposal Sent's funnel is 75, which is IKEA, while Sanofi
    // is 40. Technical Iteration's funnel rounds to 67, while Siemens is 60
    // and the stage default is 65.
    expect(within(column('Ongoing')).getByText('25% probability')).toBeTruthy();
    const ongoing = column('Ongoing').textContent?.replace(/\s+/g, '') ?? '';
    expect(ongoing).not.toContain('80%');
    expect(ongoing).not.toContain('30%');
    expect(within(column('Proposal Sent')).getByText('40% probability')).toBeTruthy();
    const sent = column('Proposal Sent').textContent?.replace(/\s+/g, '') ?? '';
    expect(sent).not.toContain('75%');
    expect(sent).not.toContain('50%');
    expect(within(column('Technical Iteration')).getByText('60% probability')).toBeTruthy();
    const technical = column('Technical Iteration').textContent?.replace(/\s+/g, '') ?? '';
    expect(technical).not.toContain('67%');
    expect(technical).not.toContain('65%');
  });

  it('states 100% on the won bid and 0% on the lost bid', () => {
    // A decided column used to omit the percent. Stellantis is a win at 100
    // and Spotify is a loss at 0. Those are the probabilities, not a funnel.
    expect(within(column('Closed Won')).getByText('100% probability')).toBeTruthy();
    expect(within(column('Closed Lost')).getByText('0% probability')).toBeTruthy();
  });

  it('does not invent a probability for the empty Lead column', () => {
    // Lead has no demo bid. The funnel divided every later card by that empty
    // stage and printed 100%. There is no win probability to show.
    const lead = column('Lead');
    expect(within(lead).queryByText(/probability/)).toBeNull();
    expect(within(lead).queryByLabelText(/Conversion rate/)).toBeNull();
    expect(within(lead).queryByText('100%')).toBeNull();
  });
});

describe('deal board column win probability when the page continues', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('does not state a column probability from a partial page', () => {
    // A continued page loaded one bid past the board and dropped it. The
    // cards in Negotiation are not every Negotiation bid, so 75% would
    // describe a slice.
    renderBoard('next');
    const negotiation = column('Negotiation');
    expect(within(negotiation).queryByText(/probability/)).toBeNull();
    expect(within(negotiation).queryByLabelText(/Conversion rate/)).toBeNull();
  });
});

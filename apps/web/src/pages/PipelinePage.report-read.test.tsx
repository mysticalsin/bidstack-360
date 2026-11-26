// The deal board keeps its four totals on screen while the cards load.
// Those totals come from /api/reports/pipeline, a second read. Until that
// read arrives, and when it fails, the row must not say the book is empty.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { PipelinePage } from './PipelinePage';
import { useOpportunities } from '@/hooks/useOpportunities';
import { usePipelineReport } from '@/hooks/usePipelineReport';
import { usePipelineStages } from '@/hooks/usePipelineStages';
import { useStageMutation } from '@/hooks/useStageMutation';
import type { Opportunity, PipelineStage } from '@bidstack/shared';

vi.mock('@/hooks/useOpportunities', () => ({
  useOpportunities: vi.fn(),
}));

vi.mock('@/hooks/usePipelineReport', () => ({
  usePipelineReport: vi.fn(),
}));

vi.mock('@/hooks/usePipelineStages', () => ({
  usePipelineStages: vi.fn(),
}));

vi.mock('@/hooks/useStageMutation', () => ({
  useStageMutation: vi.fn(),
}));

const capabilitiesMocks = vi.hoisted(() => ({ useHasPermission: vi.fn(() => true) }));
vi.mock('@/hooks/useCapabilities', () => capabilitiesMocks);

const STAGE: PipelineStage = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Qualification',
  probability: 20,
  color: '#3b82f6',
  isWon: false,
  isLost: false,
};

const OPPORTUNITY: Opportunity = {
  id: '33333333-3333-4333-8333-333333333333',
  code: 'OP-1234',
  customer: 'Acme Corp',
  name: 'Enterprise CRM rollout',
  stage: STAGE.name,
  pipelineStageId: STAGE.id,
  pipelineStage: STAGE,
  value: 250_000,
  probability: 20,
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

type ReportState = {
  data?: {
    byStage: { stage: string; count: number; valueSum: number }[];
    totalOpen: number;
    totalValueOpen: number;
    weightedPipeline: number;
    velocity: { avgDaysOpen: number; closedThisQuarter: number };
  };
  isLoading: boolean;
  isPending: boolean;
  isError: boolean;
};

const EMPTY_REPORT: NonNullable<ReportState['data']> = {
  byStage: [],
  totalOpen: 0,
  totalValueOpen: 0,
  weightedPipeline: 0,
  velocity: { avgDaysOpen: 0, closedThisQuarter: 0 },
};

const LOADED_REPORT: NonNullable<ReportState['data']> = {
  byStage: [
    { stage: 'qualification', count: 4, valueSum: 400 },
    { stage: 'closed_won', count: 1, valueSum: 100 },
    { stage: 'closed_lost', count: 1, valueSum: 50 },
  ],
  totalOpen: 4,
  totalValueOpen: 400,
  weightedPipeline: 80,
  velocity: { avgDaysOpen: 12, closedThisQuarter: 2 },
};

function kpiValue(label: string): string {
  const labelEl = screen.getByText(label);
  const valueEl = labelEl.nextElementSibling;
  return valueEl?.textContent ?? '';
}

function renderBoard(report: ReportState) {
  vi.mocked(usePipelineReport).mockReturnValue(report as unknown as ReturnType<typeof usePipelineReport>);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <PipelinePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PipelinePage report read', () => {
  beforeEach(() => {
    capabilitiesMocks.useHasPermission.mockReturnValue(true);
    vi.mocked(useOpportunities).mockReturnValue({
      data: { items: [OPPORTUNITY], nextCursor: null },
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useOpportunities>);
    vi.mocked(usePipelineStages).mockReturnValue({
      data: {
        items: [{ ...STAGE, key: STAGE.id, orderIndex: 0, forecastCategory: '', updatedAt: '' }],
      },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof usePipelineStages>);
    vi.mocked(useStageMutation).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useStageMutation>);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('does not call an unread pipeline report an empty book', () => {
    // WHY: the totals row mounts with the cards. A report that is still
    // pending has no byStage payload. Printing 0 and "No closed bids" tells
    // a reader the book has no open deals and no decisions.
    renderBoard({ data: undefined, isLoading: false, isPending: true, isError: false });

    expect(screen.getByText('Enterprise CRM rollout')).toBeTruthy();
    expect(kpiValue('Total pipeline')).toBe('…');
    expect(kpiValue('Open value')).toBe('…');
    expect(kpiValue('Win rate')).toBe('…');
    expect(kpiValue('Active deals')).toBe('…');
    expect(screen.queryByText('No closed bids')).toBeNull();
  });

  it('does not call a failed pipeline report an empty book', () => {
    // WHY: a failed /api/reports/pipeline is not a measured zero. The cards
    // can still be on the board. "No closed bids" and Active deals 0 would
    // describe a book the report never returned.
    renderBoard({ data: undefined, isLoading: false, isPending: false, isError: true });

    expect(screen.getByText('Enterprise CRM rollout')).toBeTruthy();
    expect(kpiValue('Total pipeline')).toBe('Could not load');
    expect(kpiValue('Open value')).toBe('Could not load');
    expect(kpiValue('Win rate')).toBe('Could not load');
    expect(kpiValue('Active deals')).toBe('Could not load');
    expect(screen.queryByText('No closed bids')).toBeNull();
  });

  it('keeps a loaded empty report at zero', () => {
    // WHY: a report that arrived with no rows is an empty book. That zero
    // and "No closed bids" are the measurement, not a missing payload.
    renderBoard({
      data: EMPTY_REPORT,
      isLoading: false,
      isPending: false,
      isError: false,
    });

    expect(kpiValue('Win rate')).toBe('No closed bids');
    expect(kpiValue('Active deals')).toBe('0');
    expect(kpiValue('Total pipeline')).not.toBe('Could not load');
    expect(kpiValue('Open value')).not.toBe('Could not load');
    expect(kpiValue('Total pipeline')).toMatch(/0/);
  });

  it('prints a loaded report, including a real win rate', () => {
    // WHY: once the report arrives, the row is the whole pipeline, not the
    // one card on this page. One win and one loss is 50%. Four open deals
    // stay 4. That must not collapse into the failure sentence.
    renderBoard({
      data: LOADED_REPORT,
      isLoading: false,
      isPending: false,
      isError: false,
    });

    expect(kpiValue('Win rate')).toBe('50%');
    expect(kpiValue('Active deals')).toBe('4');
    expect(kpiValue('Total pipeline')).toMatch(/550/);
    expect(kpiValue('Open value')).toMatch(/400/);
    expect(screen.queryByText('Could not load')).toBeNull();
  });
});

// A stage filter collapses the deal board to one column. The strip above it
// was still the portfolio report: 40 active deals and the whole-book open
// value, while the column held one bid. That number is the book, not the stage.
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { PipelinePage } from './PipelinePage';
import { useOpportunities } from '@/hooks/useOpportunities';
import { usePipelineReport } from '@/hooks/usePipelineReport';
import { usePipelineStages } from '@/hooks/usePipelineStages';
import { useStageMutation } from '@/hooks/useStageMutation';
import type { Opportunity, PipelineStage } from '@bidstack/shared';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback: string, opts?: Record<string, unknown>) => {
      if (!opts || typeof fallback !== 'string') return typeof fallback === 'string' ? fallback : key;
      return Object.entries(opts).reduce(
        (str, [name, value]) => str.replaceAll(`{{${name}}}`, String(value)),
        fallback,
      );
    },
    i18n: { language: 'en' },
  }),
}));

vi.mock('@/hooks/useOpportunities', () => ({ useOpportunities: vi.fn() }));
vi.mock('@/hooks/usePipelineReport', () => ({ usePipelineReport: vi.fn() }));
vi.mock('@/hooks/usePipelineStages', () => ({ usePipelineStages: vi.fn() }));
vi.mock('@/hooks/useStageMutation', () => ({ useStageMutation: vi.fn() }));
vi.mock('@/hooks/useCapabilities', () => ({ useHasPermission: () => true }));

const QUALIFICATION: PipelineStage = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Qualification',
  probability: 20,
  color: '#3b82f6',
  isWon: false,
  isLost: false,
};

const PROPOSAL: PipelineStage = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Proposal Sent',
  probability: 45,
  color: '#06b6d4',
  isWon: false,
  isLost: false,
};

const WON: PipelineStage = {
  id: 'closed_won',
  name: 'Closed Won',
  probability: 100,
  color: '#10b981',
  isWon: true,
  isLost: false,
};

function opp(overrides: Partial<Opportunity> & Pick<Opportunity, 'id' | 'pipelineStage'>): Opportunity {
  return {
    code: 'OP-1',
    customer: 'Northwind',
    name: 'Landing zone',
    stage: overrides.pipelineStage?.name ?? 'open',
    pipelineStageId: overrides.pipelineStage?.id ?? null,
    value: 2_500,
    probability: 20,
    dueDate: '2026-07-22',
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
    ...overrides,
  };
}

const OPEN_BID = opp({
  id: '33333333-3333-4333-8333-333333333333',
  code: 'OP-2041',
  name: 'CI Financial modernization',
  pipelineStage: QUALIFICATION,
  value: 2_500,
});

const OTHER_BID = opp({
  id: '44444444-4444-4444-8444-444444444444',
  code: 'OP-2042',
  name: 'Logistec readiness',
  pipelineStage: PROPOSAL,
  value: 100,
});

const WON_BID = opp({
  id: '55555555-5555-4555-8555-555555555555',
  code: 'OP-2046',
  name: 'Aritzia refresh',
  pipelineStage: WON,
  value: 410_000,
});

const BOOK = {
  byStage: [
    { stage: 's1_ongoing', count: 40, valueSum: 9_000_000 },
    { stage: 'closed_won', count: 3, valueSum: 1_000_000 },
    { stage: 'closed_lost', count: 1, valueSum: 100_000 },
  ],
  totalOpen: 40,
  totalValueOpen: 9_000_000,
  weightedPipeline: 4_000_000,
  velocity: { avgDaysOpen: 12, closedThisQuarter: 3 },
};

function renderBoard(path: string, items: Opportunity[], nextCursor: string | null = null) {
  vi.mocked(useOpportunities).mockReturnValue({
    data: { items, nextCursor },
    isLoading: false,
    isError: false,
    error: null,
  } as unknown as ReturnType<typeof useOpportunities>);
  vi.mocked(usePipelineReport).mockReturnValue({
    data: BOOK,
    isLoading: false,
    isError: false,
  } as unknown as ReturnType<typeof usePipelineReport>);
  vi.mocked(usePipelineStages).mockReturnValue({
    data: {
      items: [QUALIFICATION, PROPOSAL, WON].map((stage, index) => ({
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
    mutate: vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof useStageMutation>);

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <PipelinePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('deal board stage filter totals', () => {
  it('keeps the portfolio strip when no stage is selected', () => {
    renderBoard('/pipeline', [OPEN_BID, OTHER_BID]);

    const strip = screen.getByRole('region', { name: 'Pipeline totals' });
    expect(within(strip).getByText('Total pipeline')).toBeTruthy();
    expect(within(strip).getByText('Win rate')).toBeTruthy();
    expect(within(strip).getByText('40')).toBeTruthy();
    expect(within(strip).getByText('75%')).toBeTruthy();
    expect(strip.textContent).toMatch(/9/);
    expect(screen.queryByText(/not the whole pipeline/i)).toBeNull();
  });

  it('counts the focused column, not the portfolio, when a stage is selected', () => {
    // WHY: focusing Qualification must not keep announcing 40 active deals and
    // the book's open value. The demo column is one bid of 2,500.
    renderBoard(`/pipeline?pipelineStageId=${QUALIFICATION.id}`, [OPEN_BID, OTHER_BID]);

    const strip = screen.getByRole('region', { name: 'Qualification on this board' });
    expect(within(strip).getByText('Qualification value')).toBeTruthy();
    expect(within(strip).getByText('Deals (column)')).toBeTruthy();
    expect(within(strip).getByText('Open deals (column)')).toBeTruthy();
    expect(within(strip).getAllByText('1')).toHaveLength(2);
    expect(strip.textContent).toMatch(/2[,.]500/);
    expect(strip.textContent).toMatch(/not the whole pipeline/i);
    expect(strip.textContent).not.toMatch(/40/);
    expect(strip.textContent).not.toMatch(/75%/);
    expect(strip.textContent).not.toMatch(/9[,.]?0{3}|€9M|9M/);
    expect(within(strip).queryByText('Win rate')).toBeNull();
    expect(within(strip).queryByText('Total pipeline')).toBeNull();
  });

  it('does not count a won column as open pipeline', () => {
    renderBoard(`/pipeline?pipelineStageId=${WON.id}`, [WON_BID, OPEN_BID]);

    const strip = screen.getByRole('region', { name: 'Closed Won on this board' });
    expect(within(strip).getByText('Open deals (column)').nextElementSibling?.textContent).toBe('0');
    expect(within(strip).getByText('Deals (column)').nextElementSibling?.textContent).toBe('1');
    expect(strip.textContent).not.toMatch(/40/);
    expect(strip.textContent).not.toMatch(/75%/);
  });

  it('says the column is not every bid when the board page continues', () => {
    renderBoard(`/pipeline?pipelineStageId=${QUALIFICATION.id}`, [OPEN_BID], 'next');

    const strip = screen.getByRole('region', { name: 'Qualification on this board' });
    expect(strip.textContent).toMatch(/not every bid in that stage/i);
    expect(strip.textContent).not.toMatch(/40/);
  });

  it('shows an empty column as zero when the selected stage has no loaded bids', () => {
    renderBoard(`/pipeline?pipelineStageId=${PROPOSAL.id}`, [OPEN_BID]);

    const strip = screen.getByRole('region', { name: 'Proposal Sent on this board' });
    expect(within(strip).getByText('Deals (column)').nextElementSibling?.textContent).toBe('0');
    expect(strip.textContent).not.toMatch(/40/);
    expect(strip.textContent).not.toMatch(/2[,.]500/);
  });
});

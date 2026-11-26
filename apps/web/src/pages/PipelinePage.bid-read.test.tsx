// The deal board must not call a bid list that has not arrived an empty book.
// An idle or paused read has isLoading false and no payload. The page was
// still saying "No opportunities yet" and offering Go to Opportunities.
// A failed read with no cards is the error, not an empty book. A failed
// refresh keeps cards already on the board. A settled empty book stays empty.
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

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

const STAGE: PipelineStage = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Qualification',
  probability: 20,
  color: '#3b82f6',
  isWon: false,
  isLost: false,
};

const DEMO_BID: Opportunity = {
  id: '33333333-3333-4333-8333-333333333333',
  code: 'OP-DEMO-1',
  customer: 'Demo North',
  name: 'Demo Rollout',
  stage: STAGE.name,
  pipelineStageId: STAGE.id,
  pipelineStage: STAGE,
  value: 120_000,
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

const EMPTY_BOOK = 'No opportunities yet';
const FAILED_READ = 'Could not load pipeline';
const CLOSED_BIDS = 'No closed bids';
const ACTIVE_DEALS = 'Active deals';

type FetchStatus = 'idle' | 'paused' | 'fetching';

function bidRead(next: Record<string, unknown> = {}) {
  return {
    data: undefined,
    isPending: false,
    isLoading: false,
    isFetching: false,
    isPaused: false,
    isSuccess: false,
    isError: false,
    fetchStatus: 'idle' as FetchStatus,
    error: null,
    ...next,
  };
}

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

function expectBookNotJudged() {
  expect(screen.queryByText(EMPTY_BOOK)).toBeNull();
  expect(screen.queryByRole('button', { name: 'Go to Opportunities' })).toBeNull();
  expect(screen.queryByText(CLOSED_BIDS)).toBeNull();
  expect(screen.queryByText(ACTIVE_DEALS)).toBeNull();
  expect(screen.queryByTestId('pipeline-column')).toBeNull();
  expect(screen.queryByText('Drop here')).toBeNull();
}

describe('PipelinePage bid read', () => {
  beforeEach(() => {
    vi.mocked(usePipelineStages).mockReturnValue({
      data: {
        items: [{ ...STAGE, key: STAGE.id, orderIndex: 0, forecastCategory: '', updatedAt: '' }],
        pageContinues: false,
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

  it('does not call an unread bid list an empty book', () => {
    // WHY: the board paints before the opportunities request starts.
    // fetchStatus is idle and isLoading is false. There is no payload, so
    // the page must not say there are no opportunities and must not count
    // a zero book.
    vi.mocked(useOpportunities).mockReturnValue(
      bidRead({ isPending: true, isLoading: false, fetchStatus: 'idle' }) as ReturnType<
        typeof useOpportunities
      >,
    );
    renderBoard();

    expect(screen.getByRole('heading', { level: 1, name: /pipeline/i })).toBeTruthy();
    expect(screen.getByTestId('pipeline-board-waiting')).toBeTruthy();
    expectBookNotJudged();
    expect(screen.queryByText(FAILED_READ)).toBeNull();
  });

  it('does not call a paused bid list an empty book', () => {
    // WHY: a paused read (offline demo tab) has no rows. isLoading is false
    // because the fetch is not running. "No opportunities yet" would say the
    // book was read and it is empty.
    vi.mocked(useOpportunities).mockReturnValue(
      bidRead({
        isPending: true,
        isLoading: false,
        isFetching: false,
        isPaused: true,
        fetchStatus: 'paused',
      }) as ReturnType<typeof useOpportunities>,
    );
    renderBoard();

    expect(screen.getByTestId('pipeline-board-waiting')).toBeTruthy();
    expectBookNotJudged();
    expect(screen.queryByText(FAILED_READ)).toBeNull();
  });

  it('does not call an in-flight bid list an empty book', () => {
    // WHY: the first fetch still has no rows. The empty sentence waits until
    // a payload arrives.
    vi.mocked(useOpportunities).mockReturnValue(
      bidRead({
        isPending: true,
        isLoading: true,
        isFetching: true,
        fetchStatus: 'fetching',
      }) as ReturnType<typeof useOpportunities>,
    );
    renderBoard();

    expect(screen.queryByText(EMPTY_BOOK)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Go to Opportunities' })).toBeNull();
    expect(screen.queryByText(CLOSED_BIDS)).toBeNull();
    expect(screen.queryByTestId('pipeline-column')).toBeNull();
    expect(screen.queryByText(FAILED_READ)).toBeNull();
  });

  it('does not call a failed bid read an empty book', () => {
    // WHY: a failed read has no cards. The error is the read. It is not an
    // empty pipeline.
    vi.mocked(useOpportunities).mockReturnValue(
      bidRead({
        isError: true,
        error: new Error('Pipeline unavailable'),
      }) as ReturnType<typeof useOpportunities>,
    );
    renderBoard();

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED_READ)).toBeTruthy();
    expect(screen.getByText('Pipeline unavailable')).toBeTruthy();
    expect(screen.queryByText(EMPTY_BOOK)).toBeNull();
    expect(screen.queryByText(CLOSED_BIDS)).toBeNull();
    expect(screen.queryByTestId('pipeline-card')).toBeNull();
  });

  it('keeps a settled empty book empty', () => {
    // WHY: a payload that arrived with no rows really is empty. The empty
    // sentence stays. It is not a load failure.
    vi.mocked(useOpportunities).mockReturnValue(
      bidRead({
        data: { items: [], nextCursor: null },
        isSuccess: true,
        fetchStatus: 'idle',
      }) as ReturnType<typeof useOpportunities>,
    );
    renderBoard();

    expect(screen.getByText(EMPTY_BOOK)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Go to Opportunities' })).toBeTruthy();
    expect(screen.queryByText(FAILED_READ)).toBeNull();
    expect(screen.queryByTestId('pipeline-board-waiting')).toBeNull();
    expect(screen.queryByTestId('pipeline-card')).toBeNull();
  });

  it('keeps a loaded demo bid when a later read fails', () => {
    // WHY: a refresh that fails does not erase a bid already on the board
    // and does not replace it with an empty book or a full-page failure.
    vi.mocked(useOpportunities).mockReturnValue(
      bidRead({
        data: { items: [DEMO_BID], nextCursor: null },
        isSuccess: false,
        isError: true,
        error: new Error('Pipeline unavailable'),
        fetchStatus: 'idle',
      }) as ReturnType<typeof useOpportunities>,
    );
    renderBoard();

    expect(screen.getByText('Demo Rollout')).toBeTruthy();
    expect(screen.getByTestId('pipeline-card')).toBeTruthy();
    expect(screen.queryByText(EMPTY_BOOK)).toBeNull();
    expect(screen.queryByText(FAILED_READ)).toBeNull();
    expect(screen.queryByText('Pipeline unavailable')).toBeNull();
  });
});

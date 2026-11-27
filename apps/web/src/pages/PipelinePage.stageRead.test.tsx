// A failed stage-list read is not a finished funnel and not an empty book.
// The bids can still load. The board used to draw the default columns around
// them, which reads as the saved pipeline.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { PipelinePage } from './PipelinePage';
import { useOpportunities } from '@/hooks/useOpportunities';
import { usePipelineStages } from '@/hooks/usePipelineStages';
import { useStageMutation } from '@/hooks/useStageMutation';
import type { Opportunity } from '@bidstack/shared';

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

const BID: Opportunity = {
  id: '33333333-3333-4333-8333-333333333333',
  code: 'OP-DEMO',
  customer: 'Sample Bid Co',
  name: 'Demo rollout',
  stage: 's1_lead',
  pipelineStageId: null,
  pipelineStage: null,
  value: 250_000,
  probability: 10,
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

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

function renderPage() {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <PipelinePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function mockBids(items: Opportunity[], opts?: { failed?: boolean }) {
  vi.mocked(useOpportunities).mockReturnValue({
    data: opts?.failed ? undefined : { items, nextCursor: null },
    isLoading: false,
    isError: Boolean(opts?.failed),
    error: opts?.failed ? new Error('bids unavailable') : null,
  } as unknown as ReturnType<typeof useOpportunities>);
}

function mockStages(opts: { failed: boolean; staleName?: string }) {
  const refetch = vi.fn();
  vi.mocked(usePipelineStages).mockReturnValue({
    data: opts.staleName
      ? {
          items: [
            {
              id: '44444444-4444-4444-8444-444444444444',
              key: 'stale',
              name: opts.staleName,
              orderIndex: 0,
              probability: 10,
              forecastCategory: 'pipeline',
              isWon: false,
              isLost: false,
              color: '#3b82f6',
              updatedAt: '2026-06-01T00:00:00.000Z',
            },
          ],
          pageContinues: false,
        }
      : undefined,
    isLoading: false,
    isError: opts.failed,
    refetch,
  } as unknown as ReturnType<typeof usePipelineStages>);
  return refetch;
}

describe('PipelinePage stage list read', () => {
  beforeEach(() => {
    vi.mocked(useStageMutation).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useStageMutation>);
  });

  afterEach(() => {
    vi.clearAllMocks();
    cleanup();
  });

  it('does not draw the default funnel when the stage list failed and bids are still loaded', () => {
    // WHY: the stage request failed. The bid is real. Drawing S1 Lead around
    // it reads as the saved funnel. "No opportunities yet" would also be a lie.
    const refetch = mockStages({ failed: true });
    mockBids([BID]);

    renderPage();

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Could not load pipeline stages');
    expect(alert.textContent).toContain('not an empty pipeline');
    expect(screen.queryByText('Demo rollout')).toBeNull();
    expect(screen.queryByText('S1 Lead')).toBeNull();
    expect(screen.queryByText('No opportunities yet')).toBeNull();
    expect(screen.getByRole('status').textContent).not.toContain('opportunity');

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('does not keep a stale stage title after the stage refresh fails', () => {
    // WHY: a failed refresh must not leave the previous column looking current.
    mockStages({ failed: true, staleName: 'Stale Proposal' });
    mockBids([BID]);

    renderPage();

    expect(screen.getByRole('alert').textContent).toContain('Could not load pipeline stages');
    expect(screen.queryByText('Stale Proposal')).toBeNull();
    expect(screen.queryByText('Demo rollout')).toBeNull();
  });

  it('keeps a loaded empty book empty when the stage list also failed', () => {
    // WHY: zero bids is a finished opportunities read. The stage failure must
    // not replace that with a column error, and it must not invent columns.
    mockStages({ failed: true });
    mockBids([]);

    renderPage();

    expect(screen.getByText('No opportunities yet')).toBeTruthy();
    expect(screen.queryByText('Could not load pipeline stages')).toBeNull();
    expect(screen.queryByText('S1 Lead')).toBeNull();
  });

  it('keeps the bid-load error when the stage list failed too', () => {
    // WHY: the board has no bids to place. The opportunities failure is the
    // one the reader has to retry. A stage sentence would hide it.
    mockStages({ failed: true });
    mockBids([], { failed: true });

    renderPage();

    expect(screen.getByRole('alert').textContent).toContain('Could not load pipeline');
    expect(screen.queryByText('Could not load pipeline stages')).toBeNull();
  });

  it('still draws the bid when the stage list loaded', () => {
    mockStages({ failed: false, staleName: 'S1 Lead' });
    mockBids([{ ...BID, pipelineStageId: '44444444-4444-4444-8444-444444444444' }]);

    renderPage();

    expect(screen.getByText('Demo rollout')).toBeTruthy();
    expect(screen.queryByText('Could not load pipeline stages')).toBeNull();
  });
});

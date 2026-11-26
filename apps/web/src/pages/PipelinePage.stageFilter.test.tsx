// The stage filter sits above the board while the stage list is still unread.
// An unread list has no names. The filter used to offer the default funnel
// (S1 Lead and the rest) anyway, so a reader could treat that list as the
// saved stages.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

const SAVED_STAGE = {
  id: '44444444-4444-4444-8444-444444444444',
  key: 'qualification',
  name: 'Qualification',
  orderIndex: 0,
  probability: 20,
  forecastCategory: 'pipeline',
  isWon: false,
  isLost: false,
  color: '#3b82f6',
  updatedAt: '2026-06-01T00:00:00.000Z',
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

function mockBids(opts: { loading: boolean }) {
  vi.mocked(useOpportunities).mockReturnValue({
    data: opts.loading ? undefined : { items: [BID], nextCursor: null },
    isLoading: opts.loading,
    isError: false,
    error: null,
  } as unknown as ReturnType<typeof useOpportunities>);
}

function mockStages(opts: { unread: boolean }) {
  vi.mocked(usePipelineStages).mockReturnValue({
    data: opts.unread ? undefined : { items: [SAVED_STAGE], pageContinues: false },
    isLoading: opts.unread,
    isError: false,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof usePipelineStages>);
}

describe('PipelinePage stage filter before the stage list arrives', () => {
  afterEach(() => {
    vi.clearAllMocks();
    cleanup();
  });

  it('does not offer the default funnel while the stage list has not arrived', () => {
    // WHY: the bids can load first. The stage request is still open. Listing
    // S1 Lead in the filter reads as the saved funnel, and choosing it stores
    // a stage id the board does not have.
    vi.mocked(useStageMutation).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useStageMutation>);
    mockStages({ unread: true });
    mockBids({ loading: false });

    renderPage();

    expect(screen.queryByRole('combobox', { name: 'Filter pipeline by stage' })).toBeNull();
    expect(screen.getByText('Stages have not loaded')).toBeTruthy();
    expect(screen.queryByText('S1 Lead')).toBeNull();
    expect(screen.queryByText('Closed Won')).toBeNull();
  });

  it('does not offer the default funnel while both reads are still open', () => {
    // WHY: the first paint has neither payload. The filter must not fill the
    // wait with the default stage names.
    vi.mocked(useStageMutation).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useStageMutation>);
    mockStages({ unread: true });
    mockBids({ loading: true });

    renderPage();

    expect(screen.getByText('Stages have not loaded')).toBeTruthy();
    expect(screen.queryByText('S1 Lead')).toBeNull();
  });

  it('lists the saved stage once the stage list has arrived', () => {
    // WHY: a settled stage list is the filter. Hiding it would block a real
    // column focus. The default funnel name stays out when it was not saved.
    vi.mocked(useStageMutation).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useStageMutation>);
    mockStages({ unread: false });
    mockBids({ loading: true });

    renderPage();

    const filter = screen.getByRole('combobox', { name: 'Filter pipeline by stage' });
    expect(filter.textContent).toContain('Qualification');
    expect(filter.textContent).toContain('All');
    expect(filter.textContent).not.toContain('Stages have not loaded');
    expect(filter.textContent).not.toContain('S1 Lead');
  });
});

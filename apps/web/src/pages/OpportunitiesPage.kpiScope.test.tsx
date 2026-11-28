import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { formatUnspecifiedAmount } from '@/components/dashboard/unspecified-currency';
import { useOpportunities } from '@/hooks/useOpportunities';
import { useOrgSummary } from '@/hooks/useOrgSummary';

import { OpportunitiesPage } from './OpportunitiesPage';

vi.mock('@/hooks/useOpportunities', () => ({
  useOpportunities: vi.fn(),
  usePatchOpportunity: vi.fn(() => ({ mutate: vi.fn() })),
  useCreateOpportunity: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

vi.mock('@/hooks/useOrgSummary', () => ({ useOrgSummary: vi.fn() }));

vi.mock('@/hooks/useCapabilities', () => ({ useHasPermission: vi.fn(() => true) }));

vi.mock('@/hooks/useStageMutation', () => ({
  useStageMutation: vi.fn(() => ({ mutateAsync: vi.fn() })),
}));

vi.mock('@/hooks/usePipelineStages', () => ({
  usePipelineStages: vi.fn(() => ({
    data: { items: [] },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  })),
}));

vi.mock('@/hooks/useTerritories', () => ({
  useTerritorySegments: vi.fn(() => ({
    data: { dimension: 'industry', items: [], totals: {} },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  })),
}));

vi.mock('@/hooks/useFormatMoney', () => ({
  useFormatMoney: () => ({
    currency: 'EUR',
    convert: (value: number) => value,
    formatMoney: (value: number) => `EUR ${value.toLocaleString('en-US')}`,
    formatMoneyMicros: (micros: string | number | bigint) =>
      `EUR ${(Number(micros) / 1_000_000).toLocaleString('en-US')}`,
  }),
}));

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

const PORTFOLIO_PIPELINE = 9_000_000;

function openBid() {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    code: 'OP-0001',
    name: 'Acme Upgrade',
    customer: 'Acme Corp',
    stage: 's1_lead',
    pipelineStageId: null,
    pipelineStage: null,
    value: 2_500,
    probability: 40,
    dueDate: '2026-04-01',
    owner: 'owner@example.com',
    industry: 'Consulting',
    logo: null,
    country: 'FR',
    territoryId: null,
    territoryName: null,
    updatedAt: new Date().toISOString(),
    taskCount: 0,
    commentCount: 0,
    viewCount: 0,
  };
}

function renderAt(path: string, nextCursor: string | null = null) {
  vi.mocked(useOpportunities).mockReturnValue({
    data: { items: [openBid()], nextCursor },
    isLoading: false,
    isError: false,
    error: null,
  } as ReturnType<typeof useOpportunities>);
  vi.mocked(useOrgSummary).mockReturnValue({
    data: {
      companies: 4,
      contacts: 6,
      leads: 0,
      opportunities: 80,
      openOpportunities: 40,
      pipelineValue: PORTFOLIO_PIPELINE,
      tasks: 0,
      overdueTasks: 0,
      serviceCases: 0,
      openServiceCases: 0,
      recentActivity: [],
    },
    isLoading: false,
    isError: false,
    error: null,
  } as ReturnType<typeof useOrgSummary>);
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <OpportunitiesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Opportunities KPI strip scope', () => {
  afterEach(() => cleanup());

  it('keeps the portfolio totals when no filter is on', () => {
    renderAt('/opportunities');
    const region = screen.getByRole('region', { name: 'Opportunities KPI summary' });
    expect(region.textContent).toContain(formatUnspecifiedAmount(PORTFOLIO_PIPELINE));
    expect(region.textContent).toContain('40');
  });

  it('does not call a filtered page the whole-book pipeline', () => {
    // WHY: the overdue chip already narrows the table. The strip above it was
    // still the portfolio, so a past-due page read as a 9,000,000 book.
    renderAt('/opportunities?due=overdue', 'next-page');
    const region = screen.getByRole('region', { name: 'Filtered opportunities on this page' });
    expect(region.textContent).not.toContain(formatUnspecifiedAmount(PORTFOLIO_PIPELINE));
    expect(region.textContent).not.toContain('40');
    expect(region.textContent).toContain(formatUnspecifiedAmount(2_500));
    expect(region.textContent).toContain('These figures are this page, not every match.');
  });

  it('scopes a stage filter the same way', () => {
    // WHY: a stage chip is the same kind of narrowing as overdue. The strip
    // must follow the page, not the book, for every list filter.
    renderAt('/opportunities?pipelineStageId=s1_lead');
    const region = screen.getByRole('region', { name: 'Filtered opportunities on this page' });
    expect(region.textContent).toContain(formatUnspecifiedAmount(2_500));
    expect(region.textContent).not.toContain(formatUnspecifiedAmount(PORTFOLIO_PIPELINE));
  });

  it('scopes a search the same way', () => {
    renderAt('/opportunities?search=acme');
    const region = screen.getByRole('region', { name: 'Filtered opportunities on this page' });
    expect(region.textContent).toContain(formatUnspecifiedAmount(2_500));
    expect(region.textContent).not.toContain(formatUnspecifiedAmount(PORTFOLIO_PIPELINE));
    expect(region.textContent).not.toContain('These figures are this page, not every match.');
  });
});

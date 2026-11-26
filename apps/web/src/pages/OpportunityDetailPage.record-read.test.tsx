// A paused or in-flight opportunity read has no record yet. The detail
// page used the same "Opportunity not found" line as a settled miss, which
// tells the reader the bid was deleted. The payload has not arrived.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { OpportunityDetailPage } from './OpportunityDetailPage';
import { useOpportunity } from '@/hooks/useOpportunities';
import type { OpportunityFull } from '@/hooks/useOpportunities';
import { ApiError } from '@/lib/api';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => (typeof fallback === 'string' ? fallback : key),
    i18n: { language: 'en' },
  }),
}));

vi.mock('@/hooks/useOpportunities', () => ({
  useOpportunity: vi.fn(),
  usePatchOpportunity: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
}));

vi.mock('@/hooks/useStageMutation', () => ({
  useStageMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

vi.mock('@/hooks/useCapabilities', () => ({
  useHasPermission: vi.fn(() => true),
}));

vi.mock('@/components/opportunity/BriefingDialog', () => ({ BriefingDialog: () => null }));
vi.mock('@/components/opportunity/OpportunityTabs', () => ({ OpportunityTabs: () => null }));
vi.mock('@/components/presence/PresenceAvatars', () => ({ PresenceAvatars: () => null }));
vi.mock('@/components/opportunity/OpportunityAccountIntel', () => ({
  OpportunityAccountIntel: () => null,
}));
vi.mock('@/components/CustomFieldValuesSection', () => ({ CustomFieldValuesSection: () => null }));
vi.mock('@/components/editor/CollaborativeNotesSection', () => ({
  CollaborativeNotesSection: () => null,
}));
vi.mock('@/components/task/CreateTaskDialog', () => ({ CreateTaskDialog: () => null }));
vi.mock('@/components/calls/ScheduleReviewDialog', () => ({ ScheduleReviewDialog: () => null }));
vi.mock('./opportunityDetail/IntelCards', () => ({
  DataFreshnessRibbon: () => null,
  FinancialHealthCard: () => null,
  WinPredictionCard: () => null,
  TriggersCard: () => null,
  CompetitorRadarCard: () => null,
  NewsCard: () => null,
}));
vi.mock('./opportunityDetail/BidScoreCard', () => ({ BidScoreCard: () => null }));
vi.mock('./opportunityDetail/TimelinePanel', () => ({ TimelinePanel: () => null }));
vi.mock('./opportunityDetail/LessonsLearnedCard', () => ({ LessonsLearnedCard: () => null }));
vi.mock('@/components/bid/BidGovernancePanel', () => ({ BidGovernancePanel: () => null }));

const NOT_FOUND = 'Opportunity not found';
const DELETED = 'The opportunity may have been deleted or you may not have access to it.';
const CHECKING = 'Checking this opportunity';
const NOT_ARRIVED = 'The opportunity has not arrived.';
const LOAD_ERROR = "Couldn't load this opportunity";

const RECORD: OpportunityFull = {
  id: 'opp-northwind',
  code: 'OP-6152',
  name: 'Northwind Demo Bid',
  customer: 'Northwind Demo',
  stage: 's2_sent',
  pipelineStageId: null,
  pipelineStage: null,
  value: 500_000,
  probability: 40,
  dueDate: '2026-12-01',
  owner: null,
  industry: 'Manufacturing',
  logo: null,
  country: 'DE',
  territoryId: null,
  territoryName: null,
  updatedAt: '2026-01-01T00:00:00.000Z',
  taskCount: 0,
  commentCount: 0,
  viewCount: 0,
  intel: {},
  tasks: [],
  documents: [],
};

function mockRecord(value: Record<string, unknown>) {
  vi.mocked(useOpportunity).mockReturnValue(value as ReturnType<typeof useOpportunity>);
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/opportunities/opp-northwind']}>
        <Routes>
          <Route path="/opportunities/:id" element={<OpportunityDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('OpportunityDetailPage record read', () => {
  afterEach(() => cleanup());

  it('does not call a paused opportunity read a missing bid', () => {
    mockRecord({
      data: undefined,
      isLoading: false,
      isPending: true,
      isError: false,
      error: null,
      status: 'pending',
      fetchStatus: 'paused',
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.queryByRole('heading', { name: NOT_FOUND })).toBeNull();
    expect(screen.queryByText(DELETED)).toBeNull();
    expect(screen.getByRole('status').textContent).toContain(CHECKING);
    expect(screen.getByRole('status').textContent).toContain(NOT_ARRIVED);
  });

  it('does not call an in-flight opportunity read a missing bid', () => {
    mockRecord({
      data: undefined,
      isLoading: true,
      isPending: true,
      isError: false,
      error: null,
      status: 'pending',
      fetchStatus: 'fetching',
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.queryByRole('heading', { name: NOT_FOUND })).toBeNull();
    expect(screen.queryByText(DELETED)).toBeNull();
    expect(screen.getByRole('status').textContent).toContain(CHECKING);
    expect(screen.getByRole('status').textContent).toContain(NOT_ARRIVED);
  });

  it('keeps a failed opportunity read on the error, not on not-found', () => {
    mockRecord({
      data: undefined,
      isLoading: false,
      isPending: false,
      isError: true,
      error: new Error('Opportunity not found'),
      status: 'error',
      fetchStatus: 'idle',
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByRole('heading', { name: LOAD_ERROR })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: NOT_FOUND })).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('still says the opportunity is missing after a 404', () => {
    mockRecord({
      data: undefined,
      isLoading: false,
      isPending: false,
      isError: true,
      error: new ApiError('Opportunity not found', 404, ''),
      status: 'error',
      fetchStatus: 'idle',
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByRole('heading', { name: NOT_FOUND })).toBeTruthy();
    expect(screen.getByText(DELETED)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: LOAD_ERROR })).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('still says the opportunity is missing after a settled read with no record', () => {
    mockRecord({
      data: undefined,
      isLoading: false,
      isPending: false,
      isError: false,
      error: null,
      status: 'success',
      fetchStatus: 'idle',
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByRole('heading', { name: NOT_FOUND })).toBeTruthy();
    expect(screen.getByText(DELETED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('still shows the bid once the opportunity payload has arrived', () => {
    mockRecord({
      data: RECORD,
      isLoading: false,
      isPending: false,
      isError: false,
      error: null,
      status: 'success',
      fetchStatus: 'idle',
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByRole('heading', { name: 'Northwind Demo Bid' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: NOT_FOUND })).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });
});

// Demo OP-2041 is filed in CA and has no territory. The record header printed
// that code. The list already names the country. Opening the bid must name it
// too, or the header reads as a code the row just explained.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { OpportunityDetailPage } from './OpportunityDetailPage';
import { useOpportunity } from '@/hooks/useOpportunities';
import type { OpportunityFull } from '@/hooks/useOpportunities';

vi.mock('@/hooks/useOpportunities', () => ({
  useOpportunity: vi.fn(),
  usePatchOpportunity: vi.fn(() => ({ mutateAsync: vi.fn() })),
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

const BID: OpportunityFull = {
  id: 'opp-2041',
  code: 'OP-2041',
  name: 'CI Financial IT Modernization and MSP',
  customer: 'CI Financial',
  stage: 's3_technical_iteration',
  pipelineStageId: null,
  pipelineStage: null,
  value: 1_240_000,
  probability: 65,
  dueDate: '2026-07-22',
  owner: null,
  industry: 'financial_services',
  logo: null,
  country: 'CA',
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

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/opportunities/opp-2041']}>
        <Routes>
          <Route path="/opportunities/:id" element={<OpportunityDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('OpportunityDetailPage country under demo data', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('names Canada for a seeded bid filed in CA', () => {
    // WHY: the header sits next to the customer. CA is the stored code.
    // Printing the code makes the record disagree with the list, which
    // already says Canada for this bid.
    vi.mocked(useOpportunity).mockReturnValue({
      data: BID,
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useOpportunity>);

    renderPage();

    expect(screen.getByText('Canada')).toBeTruthy();
    expect(screen.queryByText('CA')).toBeNull();
  });

  it('keeps a territory badge when the bid has one', () => {
    vi.mocked(useOpportunity).mockReturnValue({
      data: { ...BID, territoryName: 'Ontario' },
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useOpportunity>);

    renderPage();

    expect(screen.getByText('Ontario')).toBeTruthy();
    expect(screen.queryByText('Canada')).toBeNull();
  });

  it('says No country when the bid has neither', () => {
    vi.mocked(useOpportunity).mockReturnValue({
      data: { ...BID, country: null, territoryName: null },
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useOpportunity>);

    renderPage();

    expect(screen.getByText('No country')).toBeTruthy();
  });
});

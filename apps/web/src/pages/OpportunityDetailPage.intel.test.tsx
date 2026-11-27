// Demo Siemens (and the rest of the book) has no intel payload. The deal was
// still rendering five empty cards under the "nothing queried" line.
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
vi.mock('./opportunityDetail/BidScoreCard', () => ({ BidScoreCard: () => null }));
vi.mock('./opportunityDetail/TimelinePanel', () => ({ TimelinePanel: () => null }));
vi.mock('./opportunityDetail/LessonsLearnedCard', () => ({ LessonsLearnedCard: () => null }));
vi.mock('@/components/bid/BidGovernancePanel', () => ({ BidGovernancePanel: () => null }));

const SIEMENS: OpportunityFull = {
  id: '11111111-1111-4111-8111-111111111111',
  code: 'OP-0001',
  name: 'Global ERP Modernization',
  customer: 'Siemens',
  stage: 's3_technical_iteration',
  pipelineStageId: null,
  pipelineStage: null,
  value: 1_200_000,
  probability: 60,
  dueDate: '2026-12-01',
  owner: 'sofia.almeida@bidstack-demo.dev',
  industry: 'Manufacturing',
  logo: null,
  country: 'DE',
  territoryId: null,
  territoryName: null,
  updatedAt: '2026-04-01T00:00:00.000Z',
  taskCount: 0,
  commentCount: 0,
  viewCount: 0,
  intel: {},
  tasks: [],
  documents: [],
};

const EMPTY_CARD_TITLES = [
  'Financial health',
  'Win prediction',
  'Buying triggers',
  'Competitor landscape',
  'Recent news',
];

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/opportunities/opp-1']}>
        <Routes>
          <Route path="/opportunities/:id" element={<OpportunityDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Opportunity detail intel cards', () => {
  it('does not paint empty intel cards on a bid that was never queried', () => {
    vi.mocked(useOpportunity).mockReturnValue({
      data: SIEMENS,
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useOpportunity>);

    renderPage();

    expect(
      screen.getByText('No external intel yet — sources have not been queried for this opportunity.'),
    ).toBeTruthy();
    for (const title of EMPTY_CARD_TITLES) {
      expect(screen.queryByText(title)).toBeNull();
    }
    expect(screen.queryByText('No prediction available.')).toBeNull();
    expect(screen.queryByText('No news pulled.')).toBeNull();
  });

  it('keeps a card that has a real figure and leaves the empty siblings off', () => {
    vi.mocked(useOpportunity).mockReturnValue({
      data: {
        ...SIEMENS,
        intel: {
          financial: {
            ticker: null,
            marketCap: null,
            revenueAnnual: 2_400_000_000,
            revenueGrowth: null,
            ebitdaMargin: null,
            creditRating: 'A+',
            headcount: null,
            headcountTrend: [],
            pricePoints: [],
          },
          news: [],
          triggers: [],
          competitors: [],
        },
      },
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useOpportunity>);

    renderPage();

    expect(screen.getByText('Financial health')).toBeTruthy();
    expect(screen.getByText('A+')).toBeTruthy();
    expect(screen.queryByText('Win prediction')).toBeNull();
    expect(screen.queryByText('Buying triggers')).toBeNull();
    expect(screen.queryByText('Competitor landscape')).toBeNull();
    expect(screen.queryByText('Recent news')).toBeNull();
    expect(screen.queryByText('No news pulled.')).toBeNull();
  });
});

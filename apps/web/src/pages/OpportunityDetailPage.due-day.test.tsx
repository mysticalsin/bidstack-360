// The opportunity record prints its due day beside the urgency chip.
// Demo bids store that day with no time (the curated book is 45 days out;
// the prototype book leaves OP-2041 on 2026-07-22). The instant formatter
// turns UTC midnight into the previous evening west of UTC, so the header
// and the chip disagree. An empty due date must say so, not print a dash.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { OpportunityDetailPage } from './OpportunityDetailPage';
import { useOpportunity } from '@/hooks/useOpportunities';
import type { OpportunityFull } from '@/hooks/useOpportunities';

vi.mock('@/lib/format', async () => {
  const actual = await vi.importActual<typeof import('@/lib/format')>('@/lib/format');
  return {
    ...actual,
    formatDate: (iso: string | null | undefined, locale?: string) => {
      // The shift America/Toronto applies to a date-only midnight.
      if (iso === '2026-07-22') return 'Jul 21, 2026';
      return actual.formatDate(iso, locale);
    },
  };
});

vi.mock('@/hooks/useOpportunities', () => ({
  useOpportunity: vi.fn(),
  usePatchOpportunity: vi.fn(() => ({ mutateAsync: vi.fn() })),
}));

vi.mock('@/hooks/useStageMutation', () => ({
  useStageMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

const capabilitiesMocks = vi.hoisted(() => ({ useHasPermission: vi.fn(() => true) }));
vi.mock('@/hooks/useCapabilities', () => capabilitiesMocks);

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

const READ_ONLY = 'You need opportunities write access to edit this opportunity.';

function opportunity(dueDate: string | null): OpportunityFull {
  return {
    id: 'opp-2041',
    code: 'OP-2041',
    name: 'CI Financial IT Modernization',
    customer: 'CI Financial',
    stage: 's3_technical_iteration',
    pipelineStageId: null,
    pipelineStage: null,
    value: 1_240_000,
    probability: 65,
    dueDate,
    owner: null,
    industry: 'financial_services',
    logo: null,
    country: 'CA',
    territoryId: null,
    territoryName: null,
    updatedAt: '2026-07-01T00:00:00.000Z',
    taskCount: 0,
    commentCount: 0,
    viewCount: 0,
    intel: {},
    tasks: [],
    documents: [],
  };
}

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

describe('OpportunityDetailPage due day', () => {
  beforeEach(() => {
    capabilitiesMocks.useHasPermission.mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('prints OP-2041 on 22 July 2026, not the previous evening', () => {
    vi.mocked(useOpportunity).mockReturnValue({
      data: opportunity('2026-07-22'),
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useOpportunity>);

    renderPage();

    const due = screen.getByRole('button', { name: 'Edit due date' });
    expect(due.textContent).toBe('Jul 22, 2026');
  });

  it('says when the due date is empty', () => {
    vi.mocked(useOpportunity).mockReturnValue({
      data: opportunity(null),
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useOpportunity>);

    renderPage();

    expect(screen.getByRole('button', { name: 'Edit due date' }).textContent).toBe('No due date');
  });

  it('prints the same calendar day when the record is read-only', () => {
    capabilitiesMocks.useHasPermission.mockReturnValue(false);
    vi.mocked(useOpportunity).mockReturnValue({
      data: opportunity('2026-07-22'),
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useOpportunity>);

    renderPage();

    const hints = screen.getAllByTitle(READ_ONLY);
    expect(hints.some((el) => el.textContent === 'Jul 22, 2026')).toBe(true);
    expect(hints.some((el) => el.textContent === 'Jul 21, 2026')).toBe(false);
  });
});

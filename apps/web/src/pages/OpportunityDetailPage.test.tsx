// Regression coverage: delete, every InlineEdit field (name/customer/industry/
// stage/value/probability/due date), and the Mark Won/Lost stage-change
// buttons all 403 server-side without opportunities:write. Before this fix
// they rendered enabled for every role and only failed after the click.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

const capabilitiesMocks = vi.hoisted(() => ({ useHasPermission: vi.fn(() => true) }));
// Default to full access so a future unrelated test in this file isn't
// surprised by the gating default; the gating describe block below sets it
// explicitly per-case regardless.
vi.mock('@/hooks/useCapabilities', () => capabilitiesMocks);

// Heavy record-detail sub-sections are irrelevant to write-gating and each
// pull their own data — stub them so this stays a focused test of the page's
// own header/inline-edit affordances (mirrors OpportunitiesPage.test.tsx's
// approach of mocking data hooks rather than every leaf component's network
// calls, extended here because this page composes far more sub-sections).
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
// The governance panel has its own focused test (BidGovernancePanel.test.tsx).
vi.mock('@/components/bid/BidGovernancePanel', () => ({ BidGovernancePanel: () => null }));

const OPPORTUNITY: OpportunityFull = {
  id: 'opp-1',
  code: 'OP-0099',
  name: 'Acme Modernization',
  customer: 'Acme Corp',
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

// Regression: delete/patch/stage-move all 403 server-side for a role (e.g.
// Presales) that reads but doesn't write opportunities — the frontend must
// hide/disable those affordances instead of rendering controls that always
// fail on click.
describe('OpportunityDetailPage — opportunities:write gating', () => {
  beforeEach(() => {
    vi.mocked(useOpportunity).mockReturnValue({
      data: OPPORTUNITY,
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useOpportunity>);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders delete, every InlineEdit trigger, and enabled stage-outcome buttons with opportunities:write', () => {
    capabilitiesMocks.useHasPermission.mockReturnValue(true);

    renderPage();

    expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Edit opportunity name' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Edit customer name' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Edit industry' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Change stage' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Edit deal value (EUR)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Edit probability' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Edit due date' })).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: /Mark Won/i }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(
      (screen.getByRole('button', { name: /Mark Lost/i }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('hides delete and every InlineEdit trigger, and disables stage-outcome buttons without opportunities:write', () => {
    capabilitiesMocks.useHasPermission.mockReturnValue(false);

    renderPage();

    // Values stay visible — read access is ungated — just not interactive.
    expect(screen.getByText('Acme Modernization')).toBeTruthy();
    expect(screen.getByText('Acme Corp')).toBeTruthy();
    expect(screen.getByText('Manufacturing')).toBeTruthy();

    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit opportunity name' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit customer name' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit industry' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Change stage' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit deal value (EUR)' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit probability' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit due date' })).toBeNull();

    const markWon = screen.getByRole('button', { name: /Mark Won/i }) as HTMLButtonElement;
    const markLost = screen.getByRole('button', { name: /Mark Lost/i }) as HTMLButtonElement;
    expect(markWon.disabled).toBe(true);
    expect(markLost.disabled).toBe(true);
    expect(markWon.getAttribute('title')).toBe(
      'You need opportunities write access to edit this opportunity.',
    );
  });
});

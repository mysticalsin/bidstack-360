// Demo OP-2041 is backfilled onto the pipeline stage "Technical Iteration".
// The record was still offering the legacy enum (S1 Lead …) and PATCHing
// `stage` only. That leaves pipelineStageId on the open column, so the deal
// board never moves the card and a refetch paints the old stage name.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { OpportunityDetailPage } from './OpportunityDetailPage';
import { useOpportunity, usePatchOpportunity } from '@/hooks/useOpportunities';
import { usePipelineStages } from '@/hooks/usePipelineStages';
import { useStageMutation } from '@/hooks/useStageMutation';
import type { OpportunityFull } from '@/hooks/useOpportunities';

vi.mock('@/hooks/useOpportunities', () => ({
  useOpportunity: vi.fn(),
  usePatchOpportunity: vi.fn(() => ({ mutateAsync: vi.fn() })),
}));

vi.mock('@/hooks/useStageMutation', () => ({
  useStageMutation: vi.fn(),
}));

vi.mock('@/hooks/usePipelineStages', () => ({
  usePipelineStages: vi.fn(),
}));

vi.mock('@/hooks/useCapabilities', () => ({ useHasPermission: () => true }));

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

const TECHNICAL_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
const NEGOTIATION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4';
const WON_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5';

const BACKFILL_STAGES = [
  stage('s1_lead', 'Lead', 0, false, false, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb0'),
  stage('s1_ongoing', 'Ongoing', 1, false, false, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'),
  stage('s2_sent', 'Proposal Sent', 2, false, false, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'),
  stage('s3_technical_iteration', 'Technical Iteration', 3, false, false, TECHNICAL_ID),
  stage('s4_negotiation', 'Negotiation', 4, false, false, NEGOTIATION_ID),
  stage('closed_won', 'Closed Won', 5, true, false, WON_ID),
  stage('closed_lost', 'Closed Lost', 6, false, true, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb6'),
];

function stage(
  key: string,
  name: string,
  orderIndex: number,
  isWon: boolean,
  isLost: boolean,
  id: string,
) {
  return {
    id,
    key,
    name,
    orderIndex,
    probability: 50,
    forecastCategory: 'pipeline',
    isWon,
    isLost,
    color: null,
    updatedAt: '2026-06-01T00:00:00.000Z',
  };
}

const OP_2041: OpportunityFull = {
  id: '33333333-3333-4333-8333-333333333333',
  code: 'OP-2041',
  name: 'CI Financial — IT Modernization & MSP',
  customer: 'CI Financial',
  // Serializer emits the pipeline stage name once the backfill has linked the row.
  stage: 'Technical Iteration',
  pipelineStageId: TECHNICAL_ID,
  pipelineStage: {
    id: TECHNICAL_ID,
    name: 'Technical Iteration',
    probability: 65,
    color: '#06b6d4',
    isWon: false,
    isLost: false,
  },
  value: 1_240_000,
  probability: 65,
  dueDate: '2026-07-22',
  owner: null,
  industry: 'financial_services',
  logo: null,
  country: 'CA',
  territoryId: null,
  territoryName: null,
  updatedAt: '2026-06-01T00:00:00.000Z',
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
      <MemoryRouter initialEntries={[`/opportunities/${OP_2041.id}`]}>
        <Routes>
          <Route path="/opportunities/:id" element={<OpportunityDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('deal record stage control', () => {
  const mutateAsync = vi.fn().mockResolvedValue({});
  const patch = vi.fn().mockResolvedValue({});

  beforeEach(() => {
    mutateAsync.mockClear();
    patch.mockClear();
    vi.mocked(useOpportunity).mockReturnValue({
      data: OP_2041,
      isLoading: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useOpportunity>);
    vi.mocked(usePatchOpportunity).mockReturnValue({
      mutateAsync: patch,
    } as unknown as ReturnType<typeof usePatchOpportunity>);
    vi.mocked(useStageMutation).mockReturnValue({
      mutate: vi.fn(),
      mutateAsync,
      isPending: false,
    } as unknown as ReturnType<typeof useStageMutation>);
    vi.mocked(usePipelineStages).mockReturnValue({
      data: { items: BACKFILL_STAGES, pageContinues: false },
      isLoading: false,
      isError: false,
      isSuccess: true,
    } as unknown as ReturnType<typeof usePipelineStages>);
  });

  afterEach(() => {
    cleanup();
  });

  it('moves demo OP-2041 onto the pipeline stage the board columns use', () => {
    // WHY: PATCHing the legacy enum leaves pipelineStageId on Technical
    // Iteration. The board groups by that id, so the card stays put and the
    // record paints the old name again after refetch.
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Change stage' }));
    const select = screen.getByRole('combobox', { name: 'Change stage' });
    expect((select as HTMLSelectElement).value).toBe(TECHNICAL_ID);
    expect(screen.getByRole('option', { name: 'Negotiation' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'S1 Lead' })).toBeNull();
    expect(screen.queryByRole('option', { name: 'S4 Negotiation' })).toBeNull();

    fireEvent.change(select, { target: { value: NEGOTIATION_ID } });

    expect(mutateAsync).toHaveBeenCalledWith({
      id: OP_2041.id,
      pipelineStageId: NEGOTIATION_ID,
      pipelineStage: expect.objectContaining({
        id: NEGOTIATION_ID,
        name: 'Negotiation',
        isWon: false,
        isLost: false,
      }),
    });
    expect(patch).not.toHaveBeenCalled();
  });

  it('does not offer the legacy enum when the stage list failed to load', () => {
    // WHY: the enum select is the control that writes stage and leaves the
    // board column behind. A failed read must not fall through to it.
    vi.mocked(usePipelineStages).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      isSuccess: false,
      error: new Error('stages down'),
    } as unknown as ReturnType<typeof usePipelineStages>);

    renderPage();

    expect(screen.getByText('Technical Iteration')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/could not load stages/i);
    expect(screen.queryByRole('button', { name: 'Change stage' })).toBeNull();
    expect(screen.queryByRole('option', { name: 'S1 Lead' })).toBeNull();
  });
});

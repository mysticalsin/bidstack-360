// Helper copy on Pipeline, Opportunities, and Accounts restates a control the
// page already has. These tests fail while that sentence is still rendered,
// and they keep the control: drag and arrow-move on a card, click-to-edit on
// a cell, the account counts, the health bars, and the coverage score.
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CrmCompany, CrmDeal, Opportunity, PipelineStage } from '@bidstack/shared';

import '@/i18n';

import { PipelinePage } from './PipelinePage';
import { useOpportunities } from '@/hooks/useOpportunities';
import { usePipelineStages } from '@/hooks/usePipelineStages';
import { OppPageHeader } from './opportunities/OppToolbar';
import { StageCell } from './opportunities/OppInlineEditCells';
import { AccountsAllSegment } from './accountsPage/AccountsAllSegment';

const DRAG_HELPER = /Drag a card between columns/;
const INLINE_HELPER = /click any cell to edit inline/i;
const SUMMARY_SENTENCE = /(?:company|companies) ·/;
const TILE_CAPTION = /External CRM pipeline|bid and presales|verified data cache/;
const COCKPIT_ESSAY = /Portfolio cockpit|Top gaps:|No coverage gaps in the current view/;
const CARD_ESSAY = /Missing Industry, Domain, and Logo|Next: Assign an industry/;
const MOVE_TITLE = 'Drag, or use ← / → to move stage';

vi.mock('@/components/opportunity/CreateOpportunityDialog', () => ({
  CreateOpportunityDialog: () => <button type="button">New opportunity</button>,
}));
vi.mock('@/components/opportunity/ImportOpportunitiesDialog', () => ({
  ImportOpportunitiesDialog: () => null,
}));
vi.mock('@/components/opportunity/PipelineViewSwitch', () => ({
  PipelineViewSwitch: () => <div>Pipeline view</div>,
}));
vi.mock('@/hooks/useOpportunities', () => ({ useOpportunities: vi.fn() }));
vi.mock('@/hooks/usePipelineReport', () => ({
  usePipelineReport: vi.fn(() => ({ data: undefined, isLoading: false })),
}));
vi.mock('@/hooks/usePipelineStages', () => ({ usePipelineStages: vi.fn() }));
vi.mock('@/hooks/useStageMutation', () => ({
  useStageMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));
vi.mock('@/components/ui/Toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const capabilitiesMocks = vi.hoisted(() => ({ useHasPermission: vi.fn(() => true) }));
vi.mock('@/hooks/useCapabilities', () => capabilitiesMocks);

vi.mock('@/components/company/SmartCompanyDialog', () => ({
  SmartCompanyDialog: ({ trigger }: { trigger: ReactNode }) => <>{trigger}</>,
}));
vi.mock('@/hooks/useFormatMoney', () => ({
  useFormatMoney: () => ({
    currency: 'EUR',
    convert: (v: number) => v,
    formatMoney: (v: number) => `€${v}`,
    formatMoneyMicros: (v: number) => `€${v}`,
  }),
}));
vi.mock('@/hooks/useAutopopulateSalesCompanies', () => ({
  AUTOPOPULATE_MAX: 25,
  useAutopopulateSalesCompanies: () => ({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
    data: null,
  }),
}));
const dashboardState: { current: unknown } = { current: null };
vi.mock('@/hooks/useCrmDashboard', () => ({
  useCrmDashboard: () => dashboardState.current,
}));
vi.mock('@/hooks/useMsaLeverage', () => ({
  useMsaLeverage: () => ({ isLoading: false, isError: false, data: { items: [], hemaPharmaCount: 0 } }),
}));

const STAGE_1: PipelineStage = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Qualification',
  probability: 20,
  color: '#3b82f6',
  isWon: false,
  isLost: false,
};
const STAGE_2: PipelineStage = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Proposal Sent',
  probability: 45,
  color: '#06b6d4',
  isWon: false,
  isLost: false,
};

function opportunity(id: string, name: string): Opportunity {
  return {
    id,
    code: `OP-${id.slice(0, 4)}`,
    customer: 'Acme Corp',
    name,
    stage: STAGE_1.name,
    pipelineStageId: STAGE_1.id,
    pipelineStage: STAGE_1,
    value: 250_000,
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
}

const LONG_NAME = 'North American hospital modernization program '.repeat(6).trim();

function renderPipeline(items: Opportunity[], canWrite = true) {
  capabilitiesMocks.useHasPermission.mockReturnValue(canWrite);
  vi.mocked(useOpportunities).mockReturnValue({
    data: { items, nextCursor: null },
    isLoading: false,
    isError: false,
    error: null,
  } as unknown as ReturnType<typeof useOpportunities>);
  vi.mocked(usePipelineStages).mockReturnValue({
    data: {
      items: [STAGE_1, STAGE_2].map((s, i) => ({
        ...s,
        key: s.id,
        orderIndex: i,
        forecastCategory: '',
        updatedAt: '',
      })),
    },
    isLoading: false,
  } as unknown as ReturnType<typeof usePipelineStages>);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PipelinePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function renderHeader(itemCount: number, search?: string, stageFilter: string | null = null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <OppPageHeader
          search={search}
          stageFilter={stageFilter}
          stageOptions={[STAGE_1]}
          itemCount={itemCount}
          hasData={itemCount > 0}
          onClearSearch={vi.fn()}
          onClearStageFilter={vi.fn()}
          onExportCsv={vi.fn()}
        />
        <StageCell stage={STAGE_1} options={[STAGE_1, STAGE_2]} onSave={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function company(id: string, name: string): CrmCompany {
  return {
    id,
    source: 'external_crm',
    name,
    legalName: null,
    domain: null,
    website: null,
    industry: null,
    imageUrl: null,
    employeeCount: null,
    annualRevenueMicros: null,
    status: null,
    registryIds: {},
    formerNames: [],
    incorporationDate: null,
    logo: null,
    technicalStack: [],
    confidence: 0.5,
    sourceAttribution: [],
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as CrmCompany;
}

function renderAccounts(names: string[]) {
  dashboardState.current = {
    data: {
      companies: names.map((name, i) => company(`c-${i}`, name)),
      deals: [] as CrmDeal[],
      providerHealth: [],
    },
    isLoading: false,
    isError: false,
    error: null,
  };
  return render(
    <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <AccountsAllSegment />
    </MemoryRouter>,
  );
}

describe('pipeline and accounts helper copy', () => {
  afterEach(() => {
    cleanup();
    dashboardState.current = null;
    capabilitiesMocks.useHasPermission.mockReset();
    capabilitiesMocks.useHasPermission.mockReturnValue(true);
  });

  it('drops the drag sentence when the board is empty and keeps the empty action', () => {
    renderPipeline([]);
    expect(screen.queryByText(DRAG_HELPER)).toBeNull();
    expect(screen.getByRole('heading', { name: 'Pipeline' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Go to Opportunities' })).toBeTruthy();
  });

  it('drops the drag sentence for one card and keeps drag plus the arrow hint', () => {
    renderPipeline([opportunity('33333333-3333-4333-8333-333333333333', 'Enterprise CRM rollout')]);
    expect(screen.queryByText(DRAG_HELPER)).toBeNull();
    const card = screen.getByTestId('pipeline-card');
    expect(card.getAttribute('draggable')).toBe('true');
    expect(card.getAttribute('aria-roledescription')).toBe('draggable opportunity');
    expect(card.getAttribute('aria-label')).toMatch(/left or right arrows to move stage/);
    expect(card.getAttribute('title')).toBe(MOVE_TITLE);
    expect(screen.getByRole('combobox', { name: 'Filter pipeline by stage' })).toBeTruthy();
  });

  it('drops the drag sentence when several cards are on the board', () => {
    renderPipeline([
      opportunity('33333333-3333-4333-8333-333333333331', 'First bid'),
      opportunity('33333333-3333-4333-8333-333333333332', 'Second bid'),
      opportunity('33333333-3333-4333-8333-333333333333', 'Third bid'),
    ]);
    expect(screen.queryByText(DRAG_HELPER)).toBeNull();
    const cards = screen.getAllByTestId('pipeline-card');
    expect(cards).toHaveLength(3);
    for (const card of cards) {
      expect(card.getAttribute('draggable')).toBe('true');
      expect(card.getAttribute('title')).toBe(MOVE_TITLE);
    }
  });

  it('drops the drag sentence when a card name is very long and still shows that name', () => {
    renderPipeline([opportunity('33333333-3333-4333-8333-333333333333', LONG_NAME)]);
    expect(screen.queryByText(DRAG_HELPER)).toBeNull();
    expect(screen.getByText(LONG_NAME)).toBeTruthy();
    expect(screen.getByTestId('pipeline-card').getAttribute('title')).toBe(MOVE_TITLE);
  });

  it('does not tell a reader they can drag', () => {
    renderPipeline(
      [opportunity('33333333-3333-4333-8333-333333333333', 'Enterprise CRM rollout')],
      false,
    );
    expect(screen.queryByText(DRAG_HELPER)).toBeNull();
    const card = screen.getByTestId('pipeline-card');
    expect(card.getAttribute('draggable')).toBe('false');
    expect(card.getAttribute('title')).toBeNull();
    expect(card.getAttribute('href')).toBe('/opportunities/33333333-3333-4333-8333-333333333333');
  });

  it.each([0, 1, 6])('drops the inline-edit sentence and keeps %s bids in flight', (count) => {
    renderHeader(count);
    expect(screen.queryByText(INLINE_HELPER)).toBeNull();
    expect(screen.getByText(`${count} bids in flight`)).toBeTruthy();
    const stage = screen.getByRole('button', { name: /Click to change/ });
    expect(stage.getAttribute('title')).toMatch(/Click to change/);
    expect(screen.getByRole('button', { name: 'Export visible opportunities as CSV' })).toBeTruthy();
  });

  it('keeps search and stage-filter counts when those views replace the bid line', () => {
    const { unmount } = renderHeader(2, 'acme');
    expect(screen.queryByText(INLINE_HELPER)).toBeNull();
    expect(screen.getByRole('button', { name: 'clear' })).toBeTruthy();
    expect(screen.getByText(/results for/)).toBeTruthy();
    unmount();
    renderHeader(2, undefined, STAGE_1.id);
    expect(screen.queryByText(INLINE_HELPER)).toBeNull();
    expect(screen.getByRole('button', { name: 'clear filter' })).toBeTruthy();
    expect(screen.getByText(/qualification opportunities/)).toBeTruthy();
  });

  it('drops the repeated account summary when there are no accounts and keeps the empty action', () => {
    renderAccounts([]);
    expect(screen.queryByText(SUMMARY_SENTENCE)).toBeNull();
    expect(screen.queryByText(TILE_CAPTION)).toBeNull();
    expect(screen.queryByText(COCKPIT_ESSAY)).toBeNull();
    expect(screen.queryByText('portfolio')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Accounts' })).toBeTruthy();
    expect(screen.getByText('No accounts yet')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'New account' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /import accounts from csv/i })).toBeTruthy();
    expect(screen.getByText('Strong')).toBeTruthy();
  });

  it('drops the summary and the card essay for one account and keeps the score', () => {
    renderAccounts(['Acme']);
    expect(screen.queryByText(SUMMARY_SENTENCE)).toBeNull();
    expect(screen.queryByText(TILE_CAPTION)).toBeNull();
    expect(screen.queryByText(COCKPIT_ESSAY)).toBeNull();
    expect(screen.queryByText('portfolio')).toBeNull();
    expect(screen.queryAllByText(CARD_ESSAY)).toHaveLength(0);
    expect(screen.getByText('Accounts')).toBeTruthy();
    expect(screen.getByText('Open deals')).toBeTruthy();
    expect(screen.getByText('Weighted pipeline')).toBeTruthy();
    expect(screen.getByText('Avg coverage')).toBeTruthy();
    expect(screen.getByText('Enriched profiles')).toBeTruthy();
    expect(screen.getByText('0%')).toBeTruthy();
    const coverage = document.querySelector('.account-card-coverage');
    expect(coverage?.getAttribute('title')).toMatch(/Missing Industry, Domain, and Logo/);
    expect(coverage?.getAttribute('title')).toMatch(/Next: Assign an industry/);
    expect(screen.getByRole('link', { name: 'Open Acme customer cockpit' })).toBeTruthy();
    expect(screen.getByText('Open account cockpit')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sync ERP accounts' })).toBeTruthy();
    expect(screen.getByRole('searchbox', { name: 'Search' })).toBeTruthy();
    expect(screen.getByText('At risk')).toBeTruthy();
  });

  it('drops the summary and the card essay when several accounts are in view', () => {
    renderAccounts(['Acme', 'Hema', 'Mantu']);
    expect(screen.queryByText(SUMMARY_SENTENCE)).toBeNull();
    expect(screen.queryAllByText(CARD_ESSAY)).toHaveLength(0);
    expect(screen.queryByText(COCKPIT_ESSAY)).toBeNull();
    expect(screen.getAllByText('Open account cockpit')).toHaveLength(3);
    expect(document.querySelectorAll('.account-card-coverage')).toHaveLength(3);
  });

  it('drops the card essay for a very long account name and still shows the name', () => {
    renderAccounts([LONG_NAME]);
    expect(screen.queryAllByText(CARD_ESSAY)).toHaveLength(0);
    expect(screen.queryByText(SUMMARY_SENTENCE)).toBeNull();
    expect(screen.getByText(LONG_NAME)).toBeTruthy();
    expect(screen.getByRole('link', { name: `Open ${LONG_NAME} customer cockpit` })).toBeTruthy();
    expect(document.querySelector('.account-card-coverage')?.getAttribute('title')).toMatch(
      /Missing Industry/,
    );
  });
});

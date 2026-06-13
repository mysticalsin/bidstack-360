import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';

import { DashboardPage } from './DashboardPage';
import { useCrmDashboard } from '@/hooks/useCrmDashboard';
import { useEnrichCompany } from '@/hooks/useEnrichCompany';
import { useOpportunities } from '@/hooks/useOpportunities';
import { usePipelineReport } from '@/hooks/usePipelineReport';
import { useTasks } from '@/hooks/useTasks';
import { ApiError } from '@/lib/api';
import { useIsAdmin } from '@/lib/auth';
import { useAccountHistory } from '@/stores/accountHistory';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

vi.mock('@/components/cockpit', () => ({
  ActivityTimelineCard: () => <div data-testid="activity-card" />,
  BusinessSnapshotCard: () => <div data-testid="business-card" />,
  CommandCenter: () => <div data-testid="command-center" />,
  DataTrustCard: () => <div data-testid="data-trust-card" />,
  HealthScoreCard: () => <div data-testid="health-card" />,
  KeyContactsCard: () => <div data-testid="contacts-card" />,
  KpiRow: () => <div data-testid="kpi-row" />,
  KpiSidebar: () => <div data-testid="kpi-sidebar" />,
  LiveDataMeshCard: () => <div data-testid="live-data-card" />,
  OpenIssuesCard: () => <div data-testid="issues-card" />,
  PageHead: ({ cockpit }: { cockpit: { company: { name: string } } }) => (
    <div data-testid="page-head">{cockpit.company.name}</div>
  ),
  PipelineByStageCard: () => <div data-testid="pipeline-card" />,
  RecentOpportunitiesCard: () => <div data-testid="recent-opps" />,
  RevenueEvolutionCard: () => <div data-testid="revenue-card" />,
  WinLossCard: () => <div data-testid="winloss-card" />,
  TechStackCard: () => <div data-testid="tech-card" />,
  UpsellFilesCard: () => <div data-testid="upsell-files" />,
}));

vi.mock('@/components/account-intel/InfoSearchLeadsCard', () => ({
  InfoSearchLeadsCard: () => <div data-testid="infosearch-card" />,
}));
vi.mock('@/components/account-intel/CrossSellCard', () => ({
  CrossSellCard: () => <div data-testid="cross-sell-card" />,
}));
vi.mock('@/components/account-intel/GovernanceLogCard', () => ({
  GovernanceLogCard: () => <div data-testid="governance-card" />,
}));
vi.mock('@/components/account-intel/SpotlightRefsCard', () => ({
  SpotlightRefsCard: () => <div data-testid="spotlight-card" />,
}));

vi.mock('@/components/dashboard/OrgDashboard', () => ({
  OrgDashboard: () => <div data-testid="org-dashboard" />,
}));

vi.mock('@/components/files/FilesPanel', () => ({
  FilesPanel: () => <div data-testid="files-panel" />,
}));

vi.mock('@/components/account-intel/AccountIntelPanel', () => ({
  AccountIntelPanel: () => <div data-testid="account-intel" />,
}));

vi.mock('@/components/motion/Reveal', () => ({
  Reveal: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/notes/NotesPanel', () => ({
  NotesPanel: () => <div data-testid="notes-panel" />,
}));

vi.mock('@/components/skeletons/PageSkeletons', () => ({
  DashboardSkeleton: () => <div data-testid="dashboard-skeleton" />,
}));

vi.mock('@/components/ui/StateMessages', () => ({
  ErrorState: ({
    title,
    message,
    action,
  }: {
    title: string;
    message: string;
    action?: ReactNode;
  }) => (
    <section role="alert">
      <h2>{title}</h2>
      <p>{message}</p>
      {action}
    </section>
  ),
}));

vi.mock('@/hooks/useCrmDashboard', () => ({ useCrmDashboard: vi.fn() }));
vi.mock('@/hooks/useEnrichCompany', () => ({ useEnrichCompany: vi.fn() }));
vi.mock('@/hooks/useOpportunities', () => ({ useOpportunities: vi.fn() }));
vi.mock('@/hooks/usePipelineReport', () => ({ usePipelineReport: vi.fn() }));
vi.mock('@/hooks/useTasks', () => ({ useTasks: vi.fn() }));
vi.mock('@/lib/auth', () => ({ useIsAdmin: vi.fn() }));
vi.mock('@/stores/accountHistory', () => ({ useAccountHistory: vi.fn() }));

const mutate = vi.fn();
const refetch = vi.fn();
const visit = vi.fn();

function dashboardSnapshot(freshness: 'fresh' | 'stale' | 'never' = 'fresh') {
  return {
    generatedAt: '2026-06-07T12:00:00.000Z',
    cockpit: {
      company: {
        id: 'acme',
        source: 'verified_data',
        name: 'Acme',
        legalName: 'Acme',
        domain: 'acme.com',
        website: 'https://acme.com/',
        industry: 'Technology',
        imageUrl: null,
        employeeCount: 500,
        annualRevenueMicros: null,
        status: 'active',
        registryIds: {},
        formerNames: [],
        incorporationDate: null,
        logo: null,
        technicalStack: [],
        strategicIntel: {
          provider: 'apollo_io',
          lastSyncedAt: freshness === 'never' ? null : '2026-05-29T12:00:00.000Z',
          syncMode: 'apollo_mcp_company_search',
          creditPolicy: 'free_search',
          freshness,
          employeeTrend: 'unknown',
          employeeCount: 500,
          annualRevenueMicros: null,
          intentTopics: [],
          hiringSignals: [],
          leadershipSignals: [],
          revenueSignals: [],
          newsSignals: [],
          summary: 'Apollo synced company profile.',
          limitations: [],
          signals: [],
        },
        confidence: 0.9,
        sourceAttribution: [],
        updatedAt: '2026-06-07T12:00:00.000Z',
      },
      kpis: [],
      technicalStack: [],
      health: { score: 82, band: 'good', counts: {} },
      keyContacts: [],
      recentActivity: [],
      risks: [],
      compliance: [],
      roadmap: [],
    },
    companies: [],
    deals: [],
    activities: [],
    insights: [],
    widgets: [],
    bidOpportunities: [],
    providerHealth: [],
    queueHealth: [],
    releaseScore: {
      functional: 25,
      code: 25,
      design: 25,
      infra: 25,
      total: 100,
      passed: true,
      scoredAt: '2026-06-07T12:00:00.000Z',
    },
  };
}

function renderAccountRoute() {
  return render(
    <MemoryRouter initialEntries={['/accounts/acme']}>
      <Routes>
        <Route path="/accounts/:accountId" element={<DashboardPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('DashboardPage account cockpit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    vi.mocked(usePipelineReport).mockReturnValue({} as never);
      vi.mocked(useOpportunities).mockReturnValue({
      data: { items: [] },
      isLoading: false,
    } as never);
    vi.mocked(useTasks).mockReturnValue({
      data: { items: [] },
      isLoading: false,
    } as never);
    vi.mocked(useIsAdmin).mockReturnValue(true);
    vi.mocked(useEnrichCompany).mockReturnValue({
      status: 'idle',
      mutate,
    } as never);
    vi.mocked(useAccountHistory).mockImplementation(
      (selector: (state: { visit: typeof visit }) => unknown) => selector({ visit }) as never,
    );
  });

  afterEach(() => {
    cleanup();
  });

  it('keeps the last verified cockpit visible when a background dashboard refresh fails', () => {
    vi.mocked(useCrmDashboard).mockReturnValue({
      data: dashboardSnapshot('fresh'),
      isLoading: false,
      isError: true,
      error: new Error('Request failed (500)'),
      refetch,
    } as never);

    renderAccountRoute();

    expect(screen.getByTestId('page-head').textContent).toBe('Acme');
    expect(screen.getByTestId('kpi-row')).toBeDefined();
    expect(screen.getByRole('status').textContent).toContain(
      'showing the last verified snapshot',
    );
    expect(screen.queryByText("Couldn't load the account cockpit")).toBeNull();
  });

  it('shows the fatal cockpit error only when no snapshot exists', () => {
    vi.mocked(useCrmDashboard).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('Request failed (500)'),
      refetch,
    } as never);

    renderAccountRoute();

    expect(screen.getByRole('alert')).toBeDefined();
    expect(screen.getByText("Couldn't load the account cockpit")).toBeDefined();
    expect(screen.queryByTestId('page-head')).toBeNull();
  });

  it('uses the tab-local verified cockpit snapshot when a resumed page gets a transient 500', () => {
    sessionStorage.setItem('bidstack:account-cockpit:acme', JSON.stringify(dashboardSnapshot()));
    vi.mocked(useCrmDashboard).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new ApiError('Request failed (500)', 500, null),
      refetch,
    } as never);

    renderAccountRoute();

    expect(screen.getByTestId('page-head').textContent).toBe('Acme');
    expect(screen.getByTestId('kpi-row')).toBeDefined();
    expect(screen.getByRole('status').textContent).toContain(
      'last verified snapshot',
    );
    expect(screen.queryByText("Couldn't load the account cockpit")).toBeNull();
  });

  it('does not use the tab-local cockpit snapshot for a real missing account', () => {
    sessionStorage.setItem('bidstack:account-cockpit:acme', JSON.stringify(dashboardSnapshot()));
    vi.mocked(useCrmDashboard).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new ApiError('Account not found', 404, null),
      refetch,
    } as never);

    renderAccountRoute();

    expect(screen.getByRole('alert')).toBeDefined();
    expect(screen.getByText("Couldn't load the account cockpit")).toBeDefined();
    expect(screen.queryByTestId('page-head')).toBeNull();
  });

  it('queues Apollo refresh once when account strategic intelligence is stale', async () => {
    vi.mocked(useCrmDashboard).mockReturnValue({
      data: dashboardSnapshot('stale'),
      isLoading: false,
      isError: false,
      error: null,
      refetch,
    } as never);

    renderAccountRoute();

    await waitFor(() => {
      expect(mutate).toHaveBeenCalledWith({
        id: 'acme',
        name: 'Acme',
        domain: 'acme.com',
        website: 'https://acme.com/',
      });
    });
  });
});

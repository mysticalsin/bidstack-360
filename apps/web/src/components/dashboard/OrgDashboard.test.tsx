import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { OrgDashboard } from './OrgDashboard';
import { useOrgSummary } from '@/hooks/useOrgSummary';
import { usePipelineReport } from '@/hooks/usePipelineReport';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    { get: () => (props: Record<string, unknown>) => <div {...props} /> },
  ),
  useReducedMotion: () => true,
}));

vi.mock('@/hooks/useOrgSummary', () => ({ useOrgSummary: vi.fn() }));
vi.mock('@/hooks/usePipelineReport', () => ({ usePipelineReport: vi.fn() }));
vi.mock('@/hooks/useForecasts', () => ({ useForecastProjection: () => ({ data: undefined }) }));
vi.mock('@/hooks/useOpportunityRows', () => ({ useOpportunityRows: () => ({ data: { items: [] } }) }));
vi.mock('@/hooks/useWatchdogFeed', () => ({ useWatchdogFeed: () => ({ data: undefined }) }));
vi.mock('./DashboardVisuals', () => ({
  DashboardHero: () => <div data-testid="dashboard-hero" />,
  NeedsYou: () => <div data-testid="needs-you" />,
  PipelineCard: () => <div data-testid="dashboard-pipeline" />,
  SignalsCard: () => <div data-testid="dashboard-signals" />,
  ForecastCard: () => <div />,
  WinRateTrendCard: () => <div />,
  TopAccountsBarCard: () => <div />,
  PerformanceCard: () => <div data-testid="dashboard-performance" />,
}));
vi.mock('@/components/viz/viz.css', () => ({}));
vi.mock('@/stores/currency', () => ({
  useCurrencyStore: () => ({ currency: 'EUR', convert: (v: number) => v }),
}));

// The getting-started branch is the unit under test; the command-center widgets
// are not, so stub them to a single sentinel we can assert on/against.
vi.mock('./widgets/GettingStarted', () => ({
  GettingStarted: () => <div data-testid="getting-started" />,
}));
vi.mock('./widgets/KpiRow', () => ({ KpiRow: () => <div data-testid="kpi-row" /> }));
vi.mock('./widgets/OrgCommandHero', () => ({
  OrgCommandHero: () => <div data-testid="org-command-hero" />,
}));
vi.mock('./widgets/InsightsBar', () => ({ InsightsBar: () => <div /> }));
vi.mock('./widgets/ClosingThisWeekCard', () => ({ ClosingThisWeekCard: () => <div /> }));
vi.mock('./widgets/PipelineCard', () => ({ PipelineCard: () => <div /> }));
vi.mock('./widgets/PipelineByStageMini', () => ({ PipelineByStageMini: () => <div /> }));
vi.mock('./widgets/AlertCard', () => ({ AlertCard: () => <div /> }));
vi.mock('./widgets/SidebarCards', () => ({
  QuickActionsCard: () => <div />,
  QuickLinksCard: () => <div />,
}));
vi.mock('./widgets/RecentActivityCard', () => ({ RecentActivityCard: () => <div /> }));
vi.mock('./widgets/TopAccountsCard', () => ({ TopAccountsCard: () => <div /> }));
vi.mock('./widgets/SalesFunnelCard', () => ({ SalesFunnelCard: () => <div /> }));
vi.mock('./widgets/WinRateCard', () => ({ WinRateCard: () => <div /> }));
vi.mock('@/components/motion/AnimatedMetric', () => ({
  AnimatedMetric: ({ value }: { value: string }) => <span>{value}</span>,
}));
vi.mock('@/components/motion/Reveal', () => ({
  Reveal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/skeletons/PageSkeletons', () => ({
  DashboardSkeleton: () => <div data-testid="skeleton" />,
}));
vi.mock('../../styles/org-dashboard.css', () => ({}));

const emptySummary = {
  companies: 0,
  contacts: 0,
  leads: 0,
  opportunities: 0,
  openOpportunities: 0,
  pipelineValue: 0,
  tasks: 0,
  overdueTasks: 0,
  recentActivity: [],
};

function renderDashboard() {
  return render(
    <MemoryRouter>
      <OrgDashboard />
    </MemoryRouter>,
  );
}

describe('OrgDashboard first-run state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(usePipelineReport).mockReturnValue({ data: { byStage: [] } } as never);
  });

  afterEach(() => cleanup());

  it('shows the getting-started branch when the org has zero records', () => {
    vi.mocked(useOrgSummary).mockReturnValue({
      data: emptySummary,
      isLoading: false,
      isError: false,
    } as never);

    renderDashboard();

    expect(screen.getByTestId('getting-started')).toBeDefined();
    // The full command center must not also render for an empty org.
    expect(screen.queryByTestId('kpi-row')).toBeNull();
    expect(screen.queryByTestId('dashboard-hero')).toBeNull();
  });

  it('shows one pipeline title, an honest total, and one next action once any record exists', () => {
    vi.mocked(useOrgSummary).mockReturnValue({
      data: { ...emptySummary, leads: 1, pipelineValue: 1200, openOpportunities: 2 },
      isLoading: false,
      isError: false,
    } as never);

    renderDashboard();

    expect(screen.getByTestId('kpi-row')).toBeDefined();
    // The visual hero + needs-you list lead the page for any org with data.
    expect(screen.getByTestId('dashboard-hero')).toBeDefined();
    expect(screen.getByTestId('needs-you')).toBeDefined();
    expect(screen.queryByTestId('getting-started')).toBeNull();
  });

  it('sends the next action to overdue tasks when follow-ups are late', () => {
    vi.mocked(useOrgSummary).mockReturnValue({
      data: { ...emptySummary, companies: 1, overdueTasks: 3 },
      isLoading: false,
      isError: false,
    } as never);

    renderDashboard();

    expect(screen.getByRole('link', { name: 'Review overdue tasks' }).getAttribute('href')).toBe(
      '/tasks?filter=overdue',
    );
  });
});

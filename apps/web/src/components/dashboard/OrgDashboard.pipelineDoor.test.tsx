import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
vi.mock('@/hooks/useOpportunityRows', () => ({ useOpportunityRows: () => ({ data: { items: [] }, isLoading: false }) }));
vi.mock('@/hooks/useWatchdogFeed', () => ({ useWatchdogFeed: () => ({ data: undefined, isLoading: false }) }));
vi.mock('./DashboardVisuals', () => ({
  DashboardHero: () => <div data-testid="dashboard-hero" />,
  NeedsYou: () => <div data-testid="needs-you" />,
  PipelineCard: () => <div data-testid="dashboard-pipeline" />,
  SignalsCard: () => <div />,
  ForecastCard: () => <div />,
  WinRateTrendCard: () => <div />,
  TopAccountsBarCard: () => <div />,
  PerformanceCard: () => <div />,
}));
vi.mock('@/components/viz/viz.css', () => ({}));
vi.mock('./ActivityByHourCard', () => ({ ActivityByHourCard: () => <div /> }));
vi.mock('./HemaLeverageTile', () => ({ HemaLeverageTile: () => <div /> }));
vi.mock('./widgets/GettingStarted', () => ({ GettingStarted: () => <div /> }));
vi.mock('./widgets/KpiRow', () => ({ KpiRow: () => <div data-testid="kpi-row" /> }));
vi.mock('./widgets/ClosingThisWeekCard', () => ({ ClosingThisWeekCard: () => <div /> }));
vi.mock('./widgets/RecentActivityCard', () => ({ RecentActivityCard: () => <div /> }));
vi.mock('@/components/signals/PortfolioMomentum', () => ({ default: () => <div /> }));
vi.mock('@/components/skeletons/PageSkeletons', () => ({
  DashboardSkeleton: () => <div data-testid="skeleton" />,
}));
vi.mock('../../styles/org-dashboard.css', () => ({}));

// Polo seed on 25 Nov 2026: six open bids, 11.89m, no currency on the rows.
// Won and lost bids sit beside them. The home shortcut must not open the
// board, whose Total pipeline adds those closed bids and prints euros.
const poloSummary = {
  companies: 8,
  contacts: 12,
  leads: 4,
  opportunities: 18,
  openOpportunities: 6,
  pipelineValue: 11_890_000,
  tasks: 7,
  overdueTasks: 7,
  serviceCases: 0,
  openServiceCases: 0,
  recentActivity: [],
};

function renderHome() {
  vi.mocked(usePipelineReport).mockReturnValue({ data: { byStage: [] } } as never);
  vi.mocked(useOrgSummary).mockReturnValue({
    data: poloSummary,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  } as never);
  return render(
    <MemoryRouter>
      <OrgDashboard />
    </MemoryRouter>,
  );
}

afterEach(cleanup);

describe('home pipeline door', () => {
  it('opens the opportunities list from the workspace Pipeline shortcut', () => {
    // WHY: the open book is those six bids. /pipeline is the retired board
    // door. Its headline sums won and lost into the same figure and names
    // euros. The nav already sends pipeline work to Opportunities. This
    // shortcut has to land on that same list.
    renderHome();
    fireEvent.click(screen.getByText('Workspace detail'));

    expect(screen.getByRole('link', { name: 'Pipeline' }).getAttribute('href')).toBe(
      '/opportunities',
    );
  });
});

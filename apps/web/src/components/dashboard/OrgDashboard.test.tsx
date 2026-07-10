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
    expect(screen.queryByTestId('org-command-hero')).toBeNull();
  });

  it('renders the command center once any record exists', () => {
    vi.mocked(useOrgSummary).mockReturnValue({
      data: { ...emptySummary, leads: 1 },
      isLoading: false,
      isError: false,
    } as never);

    renderDashboard();

    expect(screen.getByTestId('kpi-row')).toBeDefined();
    // The cinematic hero band is the landing moment for any org with data.
    expect(screen.getByTestId('org-command-hero')).toBeDefined();
    expect(screen.queryByTestId('getting-started')).toBeNull();
  });
});

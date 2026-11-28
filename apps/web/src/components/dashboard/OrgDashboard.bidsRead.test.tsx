// The workspace dashboard charts are the bid read. A failure is not an empty
// book, and a later failure keeps the last rows.
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { OrgDashboard } from './OrgDashboard';
import { useOrgSummary } from '@/hooks/useOrgSummary';
import { usePipelineReport } from '@/hooks/usePipelineReport';

const seen = vi.hoisted(() => ({
  hero: null as null | { rows: unknown[]; rowsPending?: boolean; rowsFailed?: boolean; onRetry?: () => void },
  needs: null as null | { rows: unknown[]; pending?: boolean; rowsFailed?: boolean; onRetry?: () => void },
  pipeline: null as null | { rows: unknown[]; rowsPending?: boolean; rowsFailed?: boolean; onRetry?: () => void },
  performance: null as null | { rows: unknown[]; rowsPending?: boolean; rowsFailed?: boolean; onRetry?: () => void },
}));

const bids = vi.hoisted(() => ({
  state: {
    data: undefined as { items: Array<{ id: string; customer: string }> } | undefined,
    isLoading: false,
    isError: true,
    refetch: vi.fn(),
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => (props: Record<string, unknown>) => <div {...props} /> }),
  useReducedMotion: () => true,
}));

vi.mock('@/hooks/useOrgSummary', () => ({ useOrgSummary: vi.fn() }));
vi.mock('@/hooks/usePipelineReport', () => ({ usePipelineReport: vi.fn() }));
vi.mock('@/hooks/useForecasts', () => ({ useForecastProjection: () => ({ data: undefined }) }));
vi.mock('@/hooks/useOpportunityRows', () => ({
  useOpportunityRows: () => bids.state,
}));
vi.mock('@/hooks/useWatchdogFeed', () => ({ useWatchdogFeed: () => ({ data: undefined, isLoading: false }) }));
vi.mock('./DashboardVisuals', () => ({
  DashboardHero: (props: NonNullable<(typeof seen)['hero']>) => {
    seen.hero = props;
    return <div data-testid="dashboard-hero" />;
  },
  NeedsYou: (props: NonNullable<(typeof seen)['needs']>) => {
    seen.needs = props;
    return <div data-testid="needs-you" />;
  },
  PipelineCard: (props: NonNullable<(typeof seen)['pipeline']>) => {
    seen.pipeline = props;
    return <div data-testid="dashboard-pipeline" />;
  },
  PerformanceCard: (props: NonNullable<(typeof seen)['performance']>) => {
    seen.performance = props;
    return <div data-testid="dashboard-performance" />;
  },
}));
vi.mock('./ActivityByHourCard', () => ({ ActivityByHourCard: () => <div /> }));
vi.mock('./HemaLeverageTile', () => ({ HemaLeverageTile: () => <div /> }));
vi.mock('@/components/signals/PortfolioMomentum', () => ({ default: () => <div /> }));
vi.mock('@/components/drill/OppDrill', () => ({ OppDrill: () => null }));
vi.mock('./widgets/KpiRow', () => ({ KpiRow: () => <div /> }));
vi.mock('./widgets/ClosingThisWeekCard', () => ({ ClosingThisWeekCard: () => <div /> }));
vi.mock('./widgets/SidebarCards', () => ({ QuickLinksCard: () => <div /> }));
vi.mock('./widgets/RecentActivityCard', () => ({ RecentActivityCard: () => <div /> }));
vi.mock('./widgets/GettingStarted', () => ({ GettingStarted: () => <div /> }));
vi.mock('@/components/skeletons/PageSkeletons', () => ({ DashboardSkeleton: () => <div /> }));
vi.mock('../../styles/org-dashboard.css', () => ({}));
vi.mock('@/components/viz/viz.css', () => ({}));
vi.mock('@/stores/currency', () => ({
  useCurrencyStore: () => ({ currency: 'EUR', convert: (v: number) => v }),
}));

const summary = {
  companies: 2,
  contacts: 3,
  leads: 1,
  opportunities: 4,
  openOpportunities: 2,
  pipelineValue: 1_000_000,
  tasks: 1,
  overdueTasks: 0,
  recentActivity: [],
};

function renderDashboard() {
  vi.mocked(useOrgSummary).mockReturnValue({
    data: summary,
    isLoading: false,
    isError: false,
  } as never);
  vi.mocked(usePipelineReport).mockReturnValue({
    data: { byStage: [], totalValueOpen: 1_000_000, weightedPipeline: 500_000 },
    isLoading: false,
  } as never);
  return render(
    <MemoryRouter>
      <OrgDashboard />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  seen.hero = null;
  seen.needs = null;
  seen.pipeline = null;
  seen.performance = null;
  vi.clearAllMocks();
});

describe('workspace dashboard bid read', () => {
  it('tells every bid chart that the read failed and retry repeats it', () => {
    // WHY: the charts used to render [] and say the book was empty. Retry has
    // to reach the same read.
    const refetch = vi.fn();
    bids.state = { data: undefined, isLoading: false, isError: true, refetch };

    renderDashboard();

    for (const card of [seen.hero, seen.needs, seen.pipeline, seen.performance]) {
      expect(card?.rows).toEqual([]);
      expect(card?.rowsFailed).toBe(true);
      expect(card?.rowsPending ?? card?.pending).not.toBe(true);
    }
    seen.pipeline?.onRetry?.();
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('keeps the last rows when a later refresh fails', () => {
    // WHY: a failed refresh is not a new empty book.
    const rows = [{ id: 'labs', customer: 'Globex Labs' }];
    bids.state = { data: { items: rows }, isLoading: false, isError: true, refetch: vi.fn() };

    renderDashboard();

    expect(seen.pipeline?.rows).toEqual(rows);
    expect(seen.pipeline?.rowsFailed).toBe(false);
    expect(seen.hero?.rowsFailed).toBe(false);
    expect(seen.performance?.rowsFailed).toBe(false);
    expect(seen.needs?.rowsFailed).toBe(false);
  });

  it('holds the charts while the first bid read is in flight', () => {
    // WHY: the summary can arrive first. The charts must not paint an empty
    // book in that gap.
    bids.state = { data: undefined, isLoading: true, isError: false, refetch: vi.fn() };

    renderDashboard();

    expect(seen.hero?.rowsPending).toBe(true);
    expect(seen.hero?.rowsFailed).toBe(false);
    expect(seen.needs?.pending).toBe(true);
    expect(seen.pipeline?.rowsPending).toBe(true);
    expect(seen.performance?.rowsPending).toBe(true);
  });
});

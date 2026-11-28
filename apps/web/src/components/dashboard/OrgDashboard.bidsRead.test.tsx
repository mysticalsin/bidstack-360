// The workspace dashboard charts are the bid read. A failure is not an empty
// book, and a later failure keeps the last rows.
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { fmtCompact } from '@/components/viz/viz-data';
import { OrgDashboard } from './OrgDashboard';
import { formatUnspecifiedAmount } from './unspecified-currency';
import { useOrgSummary } from '@/hooks/useOrgSummary';
import { usePipelineReport } from '@/hooks/usePipelineReport';

const seen = vi.hoisted(() => ({
  hero: null as null | {
    rows: unknown[];
    openValue?: number;
    weighted?: number;
    openCount?: number;
    rowsPending?: boolean;
    rowsFailed?: boolean;
    onRetry?: () => void;
  },
  needs: null as null | { rows: unknown[]; pending?: boolean; rowsFailed?: boolean; onRetry?: () => void },
  pipeline: null as null | { rows: unknown[]; rowsPending?: boolean; rowsFailed?: boolean; onRetry?: () => void },
  performance: null as null | { rows: unknown[]; rowsPending?: boolean; rowsFailed?: boolean; onRetry?: () => void },
}));

const bids = vi.hoisted(() => ({
  state: {
    data: undefined as {
      items: Array<{
        id: string;
        customer: string;
        stage?: string | null;
        value?: number | null;
        probability?: number | null;
      }>;
    } | undefined,
    isLoading: false,
    isError: true,
    refetch: vi.fn(),
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, vars?: Record<string, string | number>) => {
      if (!vars) return fallback;
      return fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(vars[name] ?? ''));
    },
  }),
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

  it('does not announce the workspace pipeline amount while the bid read failed', () => {
    // WHY: the hero says the bid read failed. The page subtitle was still
    // reading the workspace summary, so the same screen announced a healthy
    // pipeline beside that error.
    bids.state = { data: undefined, isLoading: false, isError: true, refetch: vi.fn() };

    renderDashboard();

    const sub = screen.getByText(/companies/).closest('.page-sub');
    expect(sub).toBeTruthy();
    expect(sub?.textContent).toContain('2 companies');
    expect(sub?.textContent).toContain('2 open deals');
    expect(sub?.textContent).not.toContain(fmtCompact(summary.pipelineValue));
    expect(sub?.textContent).not.toContain(formatUnspecifiedAmount(summary.pipelineValue));
    expect(within(sub as HTMLElement).queryByRole('button', { name: /Pipeline/i })).toBeNull();
    expect(seen.hero?.openValue).toBe(0);
    expect(seen.hero?.weighted).toBe(0);
    expect(seen.hero?.openCount).toBe(0);
  });

  it('does not announce the workspace pipeline amount while the bid read is loading', () => {
    // WHY: the summary can arrive before the rows. That gap is not a pipeline total.
    bids.state = { data: undefined, isLoading: true, isError: false, refetch: vi.fn() };

    renderDashboard();

    const sub = screen.getByText(/companies/).closest('.page-sub');
    expect(sub?.textContent).not.toContain(fmtCompact(summary.pipelineValue));
    expect(within(sub as HTMLElement).queryByRole('button', { name: /Pipeline/i })).toBeNull();
    expect(seen.hero?.openValue).toBe(0);
    expect(seen.hero?.weighted).toBe(0);
  });

  it('shows zero pipeline on the page only after the bid read succeeds with no rows', () => {
    // WHY: empty is zero. The workspace summary beside an empty read is a different book.
    bids.state = { data: { items: [] }, isLoading: false, isError: false, refetch: vi.fn() };

    renderDashboard();

    const sub = screen.getByText(/companies/).closest('.page-sub');
    expect(sub?.textContent).toContain('0 pipeline');
    expect(sub?.textContent).not.toContain(fmtCompact(summary.pipelineValue));
    const info = within(sub as HTMLElement).getByRole('button', { name: /Pipeline/i });
    expect(info.getAttribute('aria-label')).toContain(formatUnspecifiedAmount(0));
    expect(info.getAttribute('aria-label')).not.toContain(formatUnspecifiedAmount(summary.pipelineValue));
    expect(seen.hero?.openValue).toBe(0);
    expect(seen.hero?.weighted).toBe(0);
    expect(seen.hero?.openCount).toBe(0);
  });

  it('reads the headline from the bid rows once they are on screen', () => {
    // WHY: the chart is this read, capped at 100 bids. The pipeline report and
    // the workspace summary can name a different total. A won row is not open.
    bids.state = {
      data: {
        items: [
          { id: 'labs', customer: 'Globex Labs', stage: 's1_ongoing', value: 2_500_000, probability: 40 },
          { id: 'won', customer: 'Won Co', stage: 'closed_won', value: 9_000_000, probability: 100 },
        ],
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };

    renderDashboard();

    expect(seen.hero?.openValue).toBe(2_500_000);
    expect(seen.hero?.weighted).toBe(1_000_000);
    expect(seen.hero?.openCount).toBe(1);
    expect(seen.hero?.openValue).not.toBe(1_000_000);
    expect(seen.hero?.weighted).not.toBe(500_000);
    expect(seen.hero?.openCount).not.toBe(summary.openOpportunities);
    const sub = screen.getByText(/companies/).closest('.page-sub');
    expect(sub?.textContent).toContain(fmtCompact(2_500_000));
    expect(sub?.textContent).not.toContain(fmtCompact(summary.pipelineValue));
    const info = within(sub as HTMLElement).getByRole('button', { name: /Pipeline/i });
    expect(info.getAttribute('aria-label')).toContain(formatUnspecifiedAmount(2_500_000));
    expect(info.getAttribute('aria-label')).not.toContain(formatUnspecifiedAmount(summary.pipelineValue));
  });
});

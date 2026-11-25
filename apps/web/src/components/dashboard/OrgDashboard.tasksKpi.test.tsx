import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { OrgDashboard } from './OrgDashboard';
import { useOrgSummary } from '@/hooks/useOrgSummary';
import { usePipelineReport } from '@/hooks/usePipelineReport';

import '@/i18n';

vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get:
        () =>
        ({ children, ...rest }: { children?: React.ReactNode }) => <div {...rest}>{children}</div>,
    },
  ),
  useReducedMotion: () => true,
}));

vi.mock('@/components/motion/AnimatedNumber', () => ({
  AnimatedNumber: ({ value }: { value: number }) => <span>{value.toLocaleString()}</span>,
}));

vi.mock('@/hooks/useOrgSummary', () => ({ useOrgSummary: vi.fn() }));
vi.mock('@/hooks/usePipelineReport', () => ({ usePipelineReport: vi.fn() }));
vi.mock('@/hooks/useForecasts', () => ({ useForecastProjection: () => ({ data: undefined }) }));
vi.mock('@/hooks/useOpportunityRows', () => ({
  useOpportunityRows: () => ({ data: { items: [] }, isLoading: false }),
}));
vi.mock('@/hooks/useWatchdogFeed', () => ({ useWatchdogFeed: () => ({ data: undefined, isLoading: false }) }));
vi.mock('./DashboardVisuals', () => ({
  DashboardHero: () => <div />,
  NeedsYou: () => <div />,
  PipelineCard: () => <div />,
  PerformanceCard: () => <div />,
}));
vi.mock('./ActivityByHourCard', () => ({ ActivityByHourCard: () => <div /> }));
vi.mock('./HemaLeverageTile', () => ({ HemaLeverageTile: () => <div /> }));
vi.mock('./widgets/ClosingThisWeekCard', () => ({ ClosingThisWeekCard: () => <div /> }));
vi.mock('./widgets/SidebarCards', () => ({ QuickLinksCard: () => <div /> }));
vi.mock('./widgets/RecentActivityCard', () => ({ RecentActivityCard: () => <div /> }));
vi.mock('@/components/signals/PortfolioMomentum', () => ({
  default: () => <div />,
}));
vi.mock('@/components/viz/viz.css', () => ({}));
vi.mock('../../styles/org-dashboard.css', () => ({}));

// Polo seed (`fixtureTasks`): seven follow-ups, none done, every due date in
// May 2026. The summary counts a follow-up overdue when it is not done and
// the due date is before today. On 25 Nov 2026 that count is 7, the same as
// the total. The strip was printing only "Tasks: 7".
const DEMO_TASKS = 7;
const DEMO_OVERDUE = 7;

type Summary = {
  companies: number;
  contacts: number;
  leads: number;
  opportunities: number;
  openOpportunities: number;
  pipelineValue: number;
  tasks: number;
  overdueTasks: number;
  serviceCases: number;
  openServiceCases: number;
  recentActivity: [];
};

function summary(patch: Partial<Summary> = {}): Summary {
  return {
    companies: 8,
    contacts: 12,
    leads: 4,
    opportunities: 18,
    openOpportunities: 6,
    pipelineValue: 11_890_000,
    tasks: DEMO_TASKS,
    overdueTasks: DEMO_OVERDUE,
    serviceCases: 0,
    openServiceCases: 0,
    recentActivity: [],
    ...patch,
  };
}

function renderDashboard(state: {
  data?: Summary;
  isLoading?: boolean;
  isError?: boolean;
  error?: Error;
}) {
  vi.mocked(usePipelineReport).mockReturnValue({ data: { byStage: [] } } as never);
  vi.mocked(useOrgSummary).mockReturnValue({
    data: state.data,
    isLoading: state.isLoading ?? false,
    isError: state.isError ?? false,
    error: state.error,
    refetch: vi.fn(),
  } as never);
  return render(
    <MemoryRouter>
      <OrgDashboard />
    </MemoryRouter>,
  );
}

function openWorkspaceDetail() {
  fireEvent.click(screen.getByText('Workspace detail'));
}

afterEach(cleanup);

describe('home workspace KPI strip task caption', () => {
  it('names the demo follow-ups as overdue, and leaves the other counts bare', () => {
    renderDashboard({ data: summary() });
    openWorkspaceDetail();

    const tasks = screen.getByRole('link', { name: 'Tasks: 7, 7 overdue' });
    expect(tasks.getAttribute('href')).toBe('/tasks');
    expect(tasks.textContent).toContain('7 overdue');
    // The companies cell is a count of companies. It does not grow a caption.
    expect(screen.getByRole('link', { name: 'Companies: 8' }).getAttribute('href')).toBe(
      '/companies',
    );
  });

  it('says there are no follow-ups when the task count is zero', () => {
    renderDashboard({ data: summary({ tasks: 0, overdueTasks: 0 }) });
    openWorkspaceDetail();

    const tasks = screen.getByRole('link', { name: 'Tasks: 0, No follow-ups' });
    expect(tasks.getAttribute('href')).toBe('/tasks');
    expect(tasks.textContent).toContain('No follow-ups');
  });

  it('keeps a current task total quiet when none are overdue', () => {
    renderDashboard({ data: summary({ tasks: 4, overdueTasks: 0 }) });
    openWorkspaceDetail();

    expect(screen.getByRole('link', { name: 'Tasks: 4' }).getAttribute('href')).toBe('/tasks');
    expect(screen.queryByText(/overdue/i)).toBeNull();
    expect(screen.queryByText('No follow-ups')).toBeNull();
  });

  it('names a partial overdue count without calling the whole total late', () => {
    renderDashboard({ data: summary({ tasks: 7, overdueTasks: 2 }) });
    openWorkspaceDetail();

    expect(screen.getByRole('link', { name: 'Tasks: 7, 2 overdue' }).textContent).toContain(
      '2 overdue',
    );
    expect(screen.queryByText('All overdue')).toBeNull();
  });

  it('does not announce a zero task total while the summary is loading', () => {
    renderDashboard({ isLoading: true });

    expect(screen.queryByRole('link', { name: /Tasks/ })).toBeNull();
    expect(screen.queryByText('No follow-ups')).toBeNull();
  });

  it('does not announce a zero task total when the summary failed', () => {
    renderDashboard({ isError: true, error: new Error('summary down') });

    expect(screen.queryByRole('link', { name: /Tasks/ })).toBeNull();
    expect(screen.getByText('Could not load dashboard')).toBeTruthy();
  });
});

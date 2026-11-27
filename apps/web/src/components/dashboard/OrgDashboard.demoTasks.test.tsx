// Demo sign-in seeds five tasks. Four are open and due in a few days. The
// Stellantis handover is already done and was due two days ago. The workspace
// summary's `tasks` count includes that finished row, and `overdueTasks` stays
// 0 because a done follow-up is not overdue. The Tasks cell was printing 5,
// which reads as five live follow-ups.
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

type Summary = {
  companies: number;
  contacts: number;
  leads: number;
  opportunities: number;
  openOpportunities: number;
  pipelineValue: number;
  tasks: number;
  openTasks?: number;
  overdueTasks: number;
  serviceCases: number;
  openServiceCases: number;
  recentActivity: [];
};

function summary(patch: Partial<Summary> = {}): Summary {
  return {
    companies: 7,
    contacts: 8,
    leads: 4,
    opportunities: 6,
    openOpportunities: 4,
    pipelineValue: 6_200_000,
    tasks: 5,
    overdueTasks: 0,
    serviceCases: 0,
    openServiceCases: 0,
    recentActivity: [],
    ...patch,
  };
}

function renderDashboard(data: Summary) {
  vi.mocked(usePipelineReport).mockReturnValue({ data: { byStage: [] } } as never);
  vi.mocked(useOrgSummary).mockReturnValue({
    data,
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

function openWorkspaceDetail() {
  fireEvent.click(screen.getByText('Workspace detail'));
}

afterEach(cleanup);

describe('home Tasks count on the demo book', () => {
  it('counts the four open follow-ups and does not call the finished handover overdue', () => {
    renderDashboard(summary({ tasks: 5, openTasks: 4, overdueTasks: 0 }));
    openWorkspaceDetail();

    const tasks = screen.getByRole('link', { name: 'Tasks: 4' });
    expect(tasks.getAttribute('href')).toBe('/tasks');
    expect(screen.queryByRole('link', { name: 'Tasks: 5' })).toBeNull();
    expect(screen.queryByText(/overdue/i)).toBeNull();
  });

  it('keeps every open follow-up in the count when they are all overdue', () => {
    renderDashboard(summary({ tasks: 7, openTasks: 7, overdueTasks: 7 }));
    openWorkspaceDetail();

    expect(screen.getByRole('link', { name: 'Tasks: 7' }).getAttribute('href')).toBe('/tasks');
  });

  it('keeps the task total when the open count has not arrived', () => {
    renderDashboard(summary({ tasks: 5, overdueTasks: 0 }));
    openWorkspaceDetail();

    expect(screen.getByRole('link', { name: 'Tasks: 5' })).toBeTruthy();
  });
});

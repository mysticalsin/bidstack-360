import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import enCrm from '../../../public/locales/en/crm.json';
import { i18n } from '@/i18n';
import { OrgDashboard } from './OrgDashboard';
import { useOrgSummary } from '@/hooks/useOrgSummary';
import { usePipelineReport } from '@/hooks/usePipelineReport';

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
vi.mock('@/hooks/useOpportunityRows', () => ({ useOpportunityRows: () => ({ data: { items: [] }, isLoading: false }) }));
vi.mock('@/hooks/useWatchdogFeed', () => ({ useWatchdogFeed: () => ({ data: undefined, isLoading: false }) }));
vi.mock('./DashboardVisuals', () => ({
  DashboardHero: () => <div data-testid="dashboard-hero" />,
  NeedsYou: () => <div />,
  PipelineCard: () => <div />,
  PerformanceCard: () => <div />,
}));
vi.mock('./ActivityByHourCard', () => ({ ActivityByHourCard: () => <div /> }));
vi.mock('./HemaLeverageTile', () => ({ HemaLeverageTile: () => <div /> }));
vi.mock('./widgets/ClosingThisWeekCard', () => ({ ClosingThisWeekCard: () => <div /> }));
vi.mock('./widgets/SidebarCards', () => ({ QuickLinksCard: () => <div /> }));
vi.mock('./widgets/RecentActivityCard', () => ({ RecentActivityCard: () => <div /> }));
vi.mock('@/components/viz/viz.css', () => ({}));
vi.mock('../../styles/org-dashboard.css', () => ({}));

// The live demo book: six open bids (CI Financial, Logistec, Rush, MAPFRE,
// MAHLE, DNB Bank) worth 11.89m, plus Aritzia won and NOS lost. The hero and
// the page subtitle call 11.89m the pipeline. The workspace strip was using
// the same words for the count 6.
const DEMO_OPEN_DEALS = 6;
const DEMO_OPEN_PIPELINE = 11_890_000;

beforeAll(async () => {
  if (!i18n.isInitialized) {
    await new Promise<void>((resolve) => {
      i18n.on('initialized', () => resolve());
    });
  }
  i18n.addResourceBundle('en', 'crm', enCrm, true, true);
  await i18n.changeLanguage('en');
});

afterEach(cleanup);

describe('OrgDashboard open-deals KPI', () => {
  it('names the open-deal count as deals, and keeps 11.89m on the pipeline subtitle', () => {
    vi.mocked(usePipelineReport).mockReturnValue({ data: { byStage: [] } } as never);
    vi.mocked(useOrgSummary).mockReturnValue({
      data: {
        companies: 8,
        contacts: 12,
        leads: 4,
        opportunities: 18,
        openOpportunities: DEMO_OPEN_DEALS,
        pipelineValue: DEMO_OPEN_PIPELINE,
        tasks: 5,
        overdueTasks: 2,
        serviceCases: 0,
        openServiceCases: 0,
        recentActivity: [],
      },
      isLoading: false,
      isError: false,
    } as never);

    render(
      <MemoryRouter>
        <OrgDashboard />
      </MemoryRouter>,
    );

    expect(screen.getByText(/6 open deals/)).toBeTruthy();
    expect(screen.getByText(/11\.89m pipeline/)).toBeTruthy();

    fireEvent.click(screen.getByText('Workspace detail'));

    expect(screen.getByRole('link', { name: 'Open deals: 6' }).getAttribute('href')).toBe(
      '/opportunities',
    );
    expect(screen.queryByRole('link', { name: /Open Pipeline:\s*6/ })).toBeNull();
  });
});

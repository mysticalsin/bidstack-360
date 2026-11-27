/**
 * The org command hero reads the pipeline report and the closing-week list
 * itself. A paused, in-flight, or failed read has no payload. That gap is not
 * a clear runway, a zero closing count, or "no closed bids yet." A settled
 * empty list still says the runway is clear. A report that arrived stays.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OrgCommandHero } from './OrgCommandHero';
import { useOpportunities } from '@/hooks/useOpportunities';
import { usePipelineReport } from '@/hooks/usePipelineReport';
import type { OrgSummary } from '@/hooks/useOrgSummary';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, opts?: Record<string, unknown>) =>
      fallback.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(opts?.[name] ?? '')),
  }),
}));

vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => (props: Record<string, unknown>) => <div {...props} /> }),
  useReducedMotion: () => true,
}));

vi.mock('@/components/motion/AnimatedNumber', () => ({
  AnimatedNumber: ({ value, format }: { value: number; format?: (n: number) => string }) => (
    <span>{format ? format(value) : String(value)}</span>
  ),
}));
vi.mock('@/components/motion/AnimatedMetric', () => ({
  AnimatedMetric: ({ value }: { value: string }) => <span>{value}</span>,
}));

vi.mock('@/hooks/useOpportunities', () => ({ useOpportunities: vi.fn() }));
vi.mock('@/hooks/usePipelineReport', () => ({ usePipelineReport: vi.fn() }));
vi.mock('@/stores/currency', () => ({
  useCurrencyStore: () => ({ currency: 'EUR', convert: (v: number) => v }),
}));

const CLOSING_UNREAD = 'The closing list has not arrived.';
const CLOSING_FAILED = 'The closing list did not load.';
const REPORT_UNREAD = 'The pipeline report has not arrived.';
const REPORT_FAILED = 'The pipeline report did not load.';
const RUNWAY_CLEAR = 'runway clear';
const RUNWAY_FOCUS = 'Nothing due this week — runway is clear to advance mid-stage bids.';
const NO_CLOSED = 'No closed bids yet';
const NO_CLOSED_DETAIL = 'no closed bids yet';

const summary: OrgSummary = {
  companies: 4,
  contacts: 9,
  leads: 3,
  opportunities: 10,
  openOpportunities: 6,
  pipelineValue: 850_000,
  tasks: 12,
  overdueTasks: 0,
  serviceCases: 0,
  openServiceCases: 0,
  recentActivity: [],
};

const report = {
  byStage: [
    { stage: 'closed_won', count: 3, valueSum: 300_000 },
    { stage: 'closed_lost', count: 1, valueSum: 50_000 },
    { stage: 'proposal', count: 6, valueSum: 500_000 },
  ],
  totalOpen: 6,
  totalValueOpen: 500_000,
  weightedPipeline: 200_000,
  velocity: { avgDaysOpen: 21.4, closedThisQuarter: 2 },
};

const openReport = {
  byStage: [{ stage: 'proposal', count: 2, valueSum: 10_000 }],
  totalOpen: 2,
  totalValueOpen: 10_000,
  weightedPipeline: 4_000,
  velocity: { avgDaysOpen: 5, closedThisQuarter: 0 },
};

const closingPage = {
  items: [
    {
      id: 'o1',
      name: 'Sample Bid',
      customer: 'Demo Co',
      value: 40_000,
      stage: 'proposal',
      dueDate: '2026-07-08',
    },
  ],
};

type FetchStatus = 'idle' | 'paused' | 'fetching';

function queryState(opts: {
  data?: unknown;
  isLoading?: boolean;
  isPending?: boolean;
  isError?: boolean;
  fetchStatus?: FetchStatus;
}) {
  return {
    data: opts.data,
    isLoading: opts.isLoading ?? false,
    isPending: opts.isPending ?? false,
    isError: opts.isError ?? false,
    fetchStatus: opts.fetchStatus ?? 'idle',
    error: null,
  };
}

function mockQueries(
  reportState: ReturnType<typeof queryState>,
  closingState: ReturnType<typeof queryState>,
) {
  vi.mocked(usePipelineReport).mockReturnValue(reportState as never);
  vi.mocked(useOpportunities).mockReturnValue(closingState as never);
}

const settledReport = queryState({ data: report });
const settledClosing = queryState({ data: closingPage });

describe('Org command hero read', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('does not call a paused closing list a clear runway', () => {
    mockQueries(settledReport, queryState({ isPending: true, fetchStatus: 'paused' }));
    render(<OrgCommandHero summary={summary} />);

    expect(screen.getAllByText(CLOSING_UNREAD).length).toBeGreaterThan(0);
    expect(screen.queryByText(RUNWAY_CLEAR)).toBeNull();
    expect(screen.queryByText(RUNWAY_FOCUS)).toBeNull();
    expect(screen.getByText('75%')).toBeTruthy();
  });

  it('does not call an in-flight closing list a clear runway', () => {
    mockQueries(
      settledReport,
      queryState({ isLoading: true, isPending: true, fetchStatus: 'fetching' }),
    );
    render(<OrgCommandHero summary={summary} />);

    expect(screen.getAllByText(CLOSING_UNREAD).length).toBeGreaterThan(0);
    expect(screen.queryByText(RUNWAY_CLEAR)).toBeNull();
    expect(screen.queryByText(RUNWAY_FOCUS)).toBeNull();
  });

  it('does not call a failed closing list a clear runway', () => {
    mockQueries(settledReport, queryState({ isError: true }));
    render(<OrgCommandHero summary={summary} />);

    expect(screen.getAllByText(CLOSING_FAILED).length).toBeGreaterThan(0);
    expect(screen.queryByText(RUNWAY_CLEAR)).toBeNull();
    expect(screen.queryByText(CLOSING_UNREAD)).toBeNull();
    expect(screen.queryByText('due list unavailable')).toBeNull();
  });

  it('keeps a settled empty closing list as a clear runway', () => {
    mockQueries(settledReport, queryState({ data: { items: [] } }));
    render(<OrgCommandHero summary={summary} />);

    expect(screen.getByText(RUNWAY_CLEAR)).toBeTruthy();
    expect(screen.getByText(RUNWAY_FOCUS)).toBeTruthy();
    expect(screen.queryByText(CLOSING_UNREAD)).toBeNull();
    expect(screen.queryByText(CLOSING_FAILED)).toBeNull();
  });

  it('does not call an unread pipeline report a book with no closed bids', () => {
    mockQueries(queryState({ isPending: true, fetchStatus: 'paused' }), settledClosing);
    render(<OrgCommandHero summary={summary} />);

    expect(screen.getAllByText(REPORT_UNREAD).length).toBeGreaterThan(0);
    expect(screen.queryByText(NO_CLOSED)).toBeNull();
    expect(screen.queryByText(NO_CLOSED_DETAIL)).toBeNull();
    expect(screen.queryByText('report unavailable')).toBeNull();
    expect(screen.getByText(/40,000 at stake/)).toBeTruthy();
  });

  it('does not call an in-flight pipeline report a book with no closed bids', () => {
    mockQueries(
      queryState({ isLoading: true, isPending: true, fetchStatus: 'fetching' }),
      settledClosing,
    );
    render(<OrgCommandHero summary={summary} />);

    expect(screen.getAllByText(REPORT_UNREAD).length).toBeGreaterThan(0);
    expect(screen.queryByText(NO_CLOSED)).toBeNull();
    expect(screen.getAllByTestId('signal-skeleton').length).toBeGreaterThan(0);
  });

  it('says a failed pipeline report did not load', () => {
    mockQueries(queryState({ isError: true }), settledClosing);
    render(<OrgCommandHero summary={summary} />);

    expect(screen.getAllByText(REPORT_FAILED).length).toBeGreaterThan(0);
    expect(screen.queryByText(NO_CLOSED)).toBeNull();
    expect(screen.queryByText(NO_CLOSED_DETAIL)).toBeNull();
    expect(screen.queryByText('report unavailable')).toBeNull();
    expect(screen.queryByText(REPORT_UNREAD)).toBeNull();
  });

  it('keeps a settled report with no closed bids empty', () => {
    mockQueries(queryState({ data: openReport }), settledClosing);
    render(<OrgCommandHero summary={summary} />);

    expect(screen.getByText(NO_CLOSED)).toBeTruthy();
    expect(screen.getByText(NO_CLOSED_DETAIL)).toBeTruthy();
    expect(screen.queryByText(REPORT_UNREAD)).toBeNull();
    expect(screen.queryByText(REPORT_FAILED)).toBeNull();
  });

  it('keeps a pipeline report and closing list that have arrived', () => {
    mockQueries(settledReport, settledClosing);
    render(<OrgCommandHero summary={summary} />);

    expect(screen.getByText('75%')).toBeTruthy();
    expect(screen.getByText('3 won · 1 lost')).toBeTruthy();
    expect(screen.getByText(/40,000 at stake/)).toBeTruthy();
    expect(screen.queryByText(REPORT_UNREAD)).toBeNull();
    expect(screen.queryByText(CLOSING_UNREAD)).toBeNull();
  });
});

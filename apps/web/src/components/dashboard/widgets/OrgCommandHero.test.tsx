/**
 * OrgCommandHero tests — the org /dashboard hero band must show REAL
 * portfolio numbers (win rate derived from closed stages, closing-week value
 * at stake, weighted coverage), skeleton-load the report-backed cells, and
 * degrade to explicit "unavailable" copy instead of breaking when a source
 * query fails. Each assertion encodes the business derivation, not just
 * render success — if the win-rate math or the open/closed filter changes,
 * these fail.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OrgCommandHero } from './OrgCommandHero';
import { useOpportunities } from '@/hooks/useOpportunities';
import { usePipelineReport } from '@/hooks/usePipelineReport';
import type { OrgSummary } from '@/hooks/useOrgSummary';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    // Interpolate {{tokens}} so assertions can target the full rendered copy.
    t: (_key: string, fallback: string, opts?: Record<string, unknown>) =>
      fallback.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(opts?.[name] ?? '')),
  }),
}));

vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    { get: () => (props: Record<string, unknown>) => <div {...props} /> },
  ),
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

const summary: OrgSummary = {
  companies: 4,
  contacts: 9,
  leads: 3,
  opportunities: 10,
  openOpportunities: 6,
  pipelineValue: 850_000,
  tasks: 12,
  overdueTasks: 2,
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

// Two open bids due this week plus one already-won deal with a stale dueDate
// still inside the window — the won deal must be excluded from the count.
const closingPage = {
  items: [
    { id: 'o1', name: 'Bid A', customer: 'Acme', value: 40_000, stage: 'proposal', dueDate: '2026-07-08' },
    { id: 'o2', name: 'Bid B', customer: 'Beta', value: 10_000, stage: 's4_negotiation', dueDate: '2026-07-07' },
    { id: 'o3', name: 'Old win', customer: 'Acme', value: 99_000, stage: 'closed_won', dueDate: '2026-07-06' },
  ],
};

function mockQueries({
  reportState = { data: report, isLoading: false, isError: false },
  closingState = { data: closingPage, isLoading: false, isError: false },
}: {
  reportState?: { data?: unknown; isLoading: boolean; isError: boolean };
  closingState?: { data?: unknown; isLoading: boolean; isError: boolean };
} = {}) {
  vi.mocked(usePipelineReport).mockReturnValue(reportState as never);
  vi.mocked(useOpportunities).mockReturnValue(closingState as never);
}

describe('OrgCommandHero', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('renders the hero pipeline value with real derived portfolio signals', () => {
    mockQueries();
    render(<OrgCommandHero summary={summary} />);

    // Hero metric: pipeline value formatted as money.
    expect(screen.getByText(/850,000/)).toBeDefined();
    // Win rate = 3 won / (3 won + 1 lost) = 75%, with the source counts shown.
    expect(screen.getByText('75%')).toBeDefined();
    expect(screen.getByText('3 won · 1 lost')).toBeDefined();
    // Closing-this-week: won deal filtered out, value at stake = 40k + 10k.
    expect(screen.getByText(/50,000 at stake/)).toBeDefined();
    // Weighted coverage = 200k / 500k = 40% of the gross open value.
    expect(screen.getByText('40% of gross open value')).toBeDefined();
    // Velocity footer surfaces the report's real numbers, rounded.
    expect(screen.getByText('21 days')).toBeDefined();
    expect(screen.getByText('2 of 12 tasks')).toBeDefined();
  });

  it('skeletons the report-backed signals while the pipeline report loads', () => {
    mockQueries({ reportState: { data: undefined, isLoading: true, isError: false } });
    render(<OrgCommandHero summary={summary} />);

    // Win rate + weighted pipeline both depend on the report → 2 skeletons.
    expect(screen.getAllByTestId('signal-skeleton')).toHaveLength(2);
    // Summary-backed cells stay live: open bids renders immediately.
    expect(screen.getByText('Open bids')).toBeDefined();
    expect(screen.getByText('6')).toBeDefined();
  });

  it('degrades to explicit unavailable copy when the report errors, keeping summary data live', () => {
    mockQueries({ reportState: { data: undefined, isLoading: false, isError: true } });
    render(<OrgCommandHero summary={summary} />);

    // Win rate + weighted both say why they are blank instead of showing 0s
    // (a silent 0% win rate would misread as real performance data).
    expect(screen.getAllByText('report unavailable')).toHaveLength(2);
    expect(screen.getByText('across 4 accounts')).toBeDefined();
    expect(screen.getByText(/850,000/)).toBeDefined();
  });

  it('leads the focus line with overdue follow-ups, then the closing window', () => {
    mockQueries();
    render(<OrgCommandHero summary={summary} />);
    // overdueTasks = 2 outranks the closing window: follow-up debt blocks bids.
    expect(screen.getByText('Clear 2 overdue follow-ups before new bids go out.')).toBeDefined();
    cleanup();

    mockQueries();
    render(<OrgCommandHero summary={{ ...summary, overdueTasks: 0 }} />);
    expect(
      screen.getByText('2 bids close within 7 days — run those reviews first.'),
    ).toBeDefined();
  });
});

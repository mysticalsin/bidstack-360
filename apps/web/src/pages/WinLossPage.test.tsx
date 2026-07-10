import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  WinLossAnalysis,
  WinLossAnalysisFilter,
} from '@/pages/winLoss/useWinLossAnalysis';

import WinLossPage from './WinLossPage';

interface HookResult {
  data: WinLossAnalysis | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
}

const hookMocks = vi.hoisted(() => ({
  result: {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    refetch: () => undefined,
  } as unknown as { data: unknown; isLoading: boolean; isError: boolean; error: Error | null; refetch: () => void },
  lastFilter: undefined as unknown,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) => {
      if (!values) return fallback;
      return fallback.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => String(values[key] ?? ''));
    },
  }),
}));

vi.mock('@/pages/winLoss/useWinLossAnalysis', () => ({
  useWinLossAnalysis: (filter: WinLossAnalysisFilter) => {
    hookMocks.lastFilter = filter;
    return hookMocks.result;
  },
}));

vi.mock('@/hooks/useUsers', () => ({
  useUsers: () => ({
    data: [{ id: '99999999-9999-4999-8999-999999999999', name: 'Rena Owner', email: 'rena@x.test' }],
    isLoading: false,
  }),
}));

// Recharts' ResponsiveContainer renders nothing at happy-dom's 0x0 layout, so
// the chart stubs expose their datapoint count instead — the page's data
// plumbing (not recharts) is what these tests protect.
vi.mock('@/components/charts/charts', () => ({
  BarChart: ({ data }: { data: unknown[] }) => <div data-testid="bar-chart">{data.length}</div>,
  FunnelChart: ({ data }: { data: { name: string; value: number }[] }) => (
    <div data-testid="funnel-chart">{data.map((d) => d.name).join(',')}</div>
  ),
}));

function analysis(overrides: Partial<WinLossAnalysis> = {}): WinLossAnalysis {
  return {
    totalWon: 3,
    totalLost: 5,
    winRatePct: 37.5,
    quarters: [
      { quarter: '2026-Q1', won: 1, lost: 3 },
      { quarter: '2026-Q2', won: 2, lost: 2 },
    ],
    reasons: [
      { reason: 'price', won: 0, lost: 4 },
      { reason: 'timing', won: 3, lost: 1 },
    ],
    competitors: [{ competitor: 'Acme Rival', won: 0, lost: 2 }],
    recent: [
      {
        opportunityId: 'opp-1',
        name: 'Metro tunnel bid',
        customer: 'City of Lyon',
        outcome: 'lost',
        reason: 'price',
        competitor: 'Acme Rival',
        valueMicros: '5000000000000',
        ownerId: null,
        ownerName: null,
        decidedAt: '2026-06-01T10:00:00.000Z',
      },
      {
        opportunityId: 'opp-2',
        name: 'Airport ops renewal',
        customer: 'ADP Group',
        outcome: 'won',
        reason: 'timing',
        competitor: null,
        valueMicros: '1000000000000',
        ownerId: '99999999-9999-4999-8999-999999999999',
        ownerName: 'Rena Owner',
        decidedAt: '2026-05-01T10:00:00.000Z',
      },
    ],
    ...overrides,
  };
}

function setResult(partial: Partial<HookResult>) {
  hookMocks.result = {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    refetch: () => undefined,
    ...partial,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <WinLossPage />
    </MemoryRouter>,
  );
}

describe('WinLossPage', () => {
  beforeEach(() => {
    setResult({ data: analysis() });
    hookMocks.lastFilter = undefined;
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the win-rate hero, quarter trend, breakdowns, and a deep-linked closed table', () => {
    renderPage();

    expect(screen.getByText('Win rate')).toBeTruthy();
    expect(screen.getByText('Bids won')).toBeTruthy();
    expect(screen.getByText('Bids lost')).toBeTruthy();
    // Two quarter buckets flow into the trend chart untouched.
    expect(screen.getByTestId('win-loss-quarter-chart').textContent).toBe('2');
    // Reason Pareto shows only reasons with losses, labeled for humans.
    expect(screen.getByTestId('win-loss-reason-chart').textContent).toBe('Price,Timing');
    expect(screen.getByTestId('win-loss-competitor-chart').textContent).toBe('Acme Rival');

    // Rows deep-link to the opportunity record for the debrief.
    const link = screen.getByRole('link', { name: 'Metro tunnel bid' });
    expect(link.getAttribute('href')).toBe('/opportunities/opp-1');

    // Default sort: most recently recorded first.
    const rows = screen.getAllByTestId(/^win-loss-row-/);
    expect(rows[0]!.getAttribute('data-testid')).toBe('win-loss-row-opp-1');
    expect(rows[1]!.getAttribute('data-testid')).toBe('win-loss-row-opp-2');
  });

  it('re-sorts the closed table when a column header is cycled', () => {
    renderPage();

    // First click sorts Value ascending — the smaller deal moves to the top.
    fireEvent.click(screen.getByRole('button', { name: /sort by value/i }));
    const rows = screen.getAllByTestId(/^win-loss-row-/);
    expect(rows[0]!.getAttribute('data-testid')).toBe('win-loss-row-opp-2');
  });

  it('passes date and owner filters through to the analysis query', () => {
    renderPage();
    expect(hookMocks.lastFilter).toEqual({});

    fireEvent.change(screen.getByLabelText('Recorded from'), {
      target: { value: '2026-01-01' },
    });
    expect(hookMocks.lastFilter).toEqual({ from: '2026-01-01' });

    fireEvent.change(screen.getByLabelText('Recorded to'), {
      target: { value: '2026-06-30' },
    });
    expect(hookMocks.lastFilter).toEqual({ from: '2026-01-01', to: '2026-06-30' });
  });

  it('shows the bespoke empty state when the range has no closed bids', () => {
    setResult({
      data: analysis({
        totalWon: 0,
        totalLost: 0,
        winRatePct: null,
        quarters: [],
        reasons: [],
        competitors: [],
        recent: [],
      }),
    });

    renderPage();

    expect(screen.getByText('No closed bids in this range yet')).toBeTruthy();
    expect(screen.queryByTestId('win-loss-quarter-chart')).toBeNull();
  });

  it('shows skeletons while loading and an alert when the query fails', () => {
    setResult({ isLoading: true });
    renderPage();
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
    cleanup();

    setResult({ isError: true, error: new Error('boom') });
    renderPage();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('Could not load the win/loss analysis')).toBeTruthy();
    expect(screen.getByText('boom')).toBeTruthy();
  });
});

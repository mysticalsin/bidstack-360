// The win/loss review asks for the closed-bid analysis as soon as the page
// opens. Until that read arrives, the quarters and the closed table are not
// a settled result. A paused read has no payload and isLoading is false, so
// the page says "No closed bids in this range yet". An in-flight read is the
// same unread review. That sentence is for a review that arrived empty. It
// is not an empty book, and hiding the Win/Loss heading would say the review
// is missing. Under demo synthetic data the book is not empty.
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WinLossAnalysis } from '@/pages/winLoss/useWinLossAnalysis';

import WinLossPage from './WinLossPage';

const analysis = vi.hoisted(() => ({
  data: undefined as WinLossAnalysis | undefined,
  isPending: true,
  isLoading: false,
  isFetching: false,
  isPaused: false,
  isError: false,
  fetchStatus: 'idle' as 'idle' | 'paused' | 'fetching',
  error: null as Error | null,
  refetch: () => undefined,
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
  useWinLossAnalysis: () => analysis,
}));

vi.mock('@/hooks/useUsers', () => ({
  useUsers: () => ({
    data: [{ id: '99999999-9999-4999-8999-999999999999', name: 'Pat Demo', email: 'pat.demo@example.test' }],
    isLoading: false,
  }),
}));

vi.mock('@/components/charts/charts', () => ({
  BarChart: () => <div data-testid="bar-chart" />,
  FunnelChart: () => <div data-testid="funnel-chart" />,
}));

// Synthetic demo closed bid. example.test is not a person. The row is what
// the review shows once the read arrives. It must not be treated as absent
// before that.
const DEMO_ROW = {
  opportunityId: 'opp-demo-north',
  name: 'Demo North tunnel',
  customer: 'Demo Civic',
  outcome: 'lost' as const,
  reason: 'price' as const,
  competitor: 'Demo Rival',
  valueMicros: '4200000000000',
  ownerId: '99999999-9999-4999-8999-999999999999',
  ownerName: 'Pat Demo',
  decidedAt: '2026-06-01T10:00:00.000Z',
};

const CHECKING = 'Checking the win/loss review. It has not arrived.';
const FAILED_TITLE = 'Could not load the win/loss analysis';
const EMPTY = 'No closed bids in this range yet';
const EMPTY_LIE = /no closed bids|review is empty|review is missing|all clear|0 bids/i;

function demoAnalysis(overrides: Partial<WinLossAnalysis> = {}): WinLossAnalysis {
  return {
    totalWon: 2,
    totalLost: 1,
    winRatePct: 66.7,
    quarters: [{ quarter: '2026-Q2', won: 2, lost: 1 }],
    reasons: [{ reason: 'price', won: 0, lost: 1 }],
    competitors: [{ competitor: 'Demo Rival', won: 0, lost: 1 }],
    cycleDays: [40],
    recent: [DEMO_ROW],
    ...overrides,
  };
}

function setAnalysis(next: Partial<typeof analysis>) {
  analysis.data = undefined;
  analysis.isPending = false;
  analysis.isLoading = false;
  analysis.isFetching = false;
  analysis.isPaused = false;
  analysis.isError = false;
  analysis.fetchStatus = 'idle';
  analysis.error = null;
  Object.assign(analysis, next);
}

function renderPage() {
  return render(
    <MemoryRouter>
      <WinLossPage />
    </MemoryRouter>,
  );
}

function expectNotEmptyOrMissing() {
  expect(screen.queryByText(EMPTY)).toBeNull();
  expect(screen.queryByText(EMPTY_LIE)).toBeNull();
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.queryByText(DEMO_ROW.name)).toBeNull();
  expect(screen.queryByText('Win rate')).toBeNull();
  expect(screen.queryByText('Bids won')).toBeNull();
  expect(screen.queryByText('Bids lost')).toBeNull();
  expect(screen.queryByLabelText('Loading KPI')).toBeNull();
  expect(screen.queryByLabelText('Loading chart')).toBeNull();
}

describe('WinLossPage read', () => {
  beforeEach(() => {
    setAnalysis({ isPending: true, fetchStatus: 'idle' });
  });

  afterEach(() => {
    cleanup();
  });

  it('does not call an unread win/loss review empty', () => {
    // WHY: the demo review paints before the request starts. fetchStatus is
    // idle and isLoading is false, so "No closed bids in this range yet"
    // looks like a review that was read and found clear. The synthetic Demo
    // North tunnel bid has not been read. That is not an empty book and not
    // a missing review.
    setAnalysis({ isPending: true, isLoading: false, isPaused: false, fetchStatus: 'idle' });
    renderPage();

    expect(screen.getByRole('heading', { name: 'Win/Loss review' })).toBeTruthy();
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.getByText(CHECKING)).toBeTruthy();
    expectNotEmptyOrMissing();
    expect(screen.queryByText(FAILED_TITLE)).toBeNull();
  });

  it('does not call a paused win/loss review empty', () => {
    // WHY: a paused read (offline demo tab) has no closed bids in hand.
    // isLoading is false because the fetch is not running. The empty sentence
    // would say the range already has no outcomes, including Demo North tunnel.
    setAnalysis({
      isPending: true,
      isLoading: false,
      isFetching: false,
      isPaused: true,
      fetchStatus: 'paused',
    });
    renderPage();

    expect(screen.getByRole('heading', { name: 'Win/Loss review' })).toBeTruthy();
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.getByText(CHECKING)).toBeTruthy();
    expectNotEmptyOrMissing();
    expect(screen.queryByText(FAILED_TITLE)).toBeNull();
  });

  it('does not call an in-flight win/loss review empty', () => {
    // WHY: the first fetch is the same unread review. A loading skeleton is
    // not a result, and "No closed bids in this range yet" is a review that
    // arrived empty. Hiding the heading would say the review is missing.
    setAnalysis({
      isPending: true,
      isLoading: true,
      isFetching: true,
      isPaused: false,
      fetchStatus: 'fetching',
    });
    renderPage();

    expect(screen.getByRole('heading', { name: 'Win/Loss review' })).toBeTruthy();
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.getByText(CHECKING)).toBeTruthy();
    expectNotEmptyOrMissing();
    expect(screen.queryByText(FAILED_TITLE)).toBeNull();
  });

  it('does not call a failed win/loss review a missing review', () => {
    // WHY: a failed read is not a range that closed nothing and not a review
    // that disappeared. The empty sentence would hide the failure.
    setAnalysis({ isError: true, error: new Error('Win/loss review unavailable') });
    renderPage();

    expect(screen.getByRole('heading', { name: 'Win/Loss review' })).toBeTruthy();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED_TITLE)).toBeTruthy();
    expect(screen.getByText('Win/loss review unavailable')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByText(DEMO_ROW.name)).toBeNull();
  });

  it('keeps a settled empty review empty', () => {
    // WHY: a read that arrived with no won or lost bids really has nothing in
    // this range. That sentence is the result, not a payload that has not arrived.
    setAnalysis({
      data: demoAnalysis({
        totalWon: 0,
        totalLost: 0,
        winRatePct: null,
        quarters: [],
        reasons: [],
        competitors: [],
        cycleDays: [],
        recent: [],
      }),
    });
    renderPage();

    expect(screen.getByText(EMPTY)).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED_TITLE)).toBeNull();
    expect(screen.queryByText(DEMO_ROW.name)).toBeNull();
  });

  it('keeps a loaded synthetic closed bid on the review', () => {
    // WHY: a payload that arrived, including one demo Demo North tunnel row,
    // is the review. The hold is only for a read that has not arrived.
    setAnalysis({ data: demoAnalysis() });
    renderPage();

    expect(screen.getByRole('heading', { name: 'Win/Loss review' })).toBeTruthy();
    expect(screen.getByText('Win rate')).toBeTruthy();
    expect(screen.getByRole('link', { name: DEMO_ROW.name })).toBeTruthy();
    expect(screen.getByText('Demo Civic')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED_TITLE)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
  });

  it('keeps a loaded review when a later read fails', () => {
    // WHY: a refresh that fails does not erase closed bids already on screen.
    // The failure sentence is for a read that never arrived.
    setAnalysis({
      data: demoAnalysis(),
      isError: true,
      isFetching: false,
      error: new Error('Win/loss review unavailable'),
    });
    renderPage();

    expect(screen.getByRole('link', { name: DEMO_ROW.name })).toBeTruthy();
    expect(screen.queryByText(FAILED_TITLE)).toBeNull();
    expect(screen.queryByText('Win/loss review unavailable')).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });
});

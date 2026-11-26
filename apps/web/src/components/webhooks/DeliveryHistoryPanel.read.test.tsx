// Expanding one endpoint asks for its delivery history. Until that read
// arrives, the panel is not an empty history. A paused read has no payload
// and isLoading is false, so the panel says "No deliveries recorded yet."
// An in-flight read only shows a skeleton. That empty sentence is for a
// history that arrived with no rows. It is not a history that has not arrived.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const history = vi.hoisted(() => ({
  data: undefined as
    | {
        data: Array<{
          id: string;
          event: string;
          statusCode: number | null;
          success: boolean;
          durationMs: number | null;
          attempt: number;
          errorMessage: string | null;
          createdAt: string;
        }>;
        hasMore: boolean;
      }
    | undefined,
  isPending: true,
  isLoading: false,
  isFetching: false,
  isPaused: false,
  isError: false,
  fetchStatus: 'idle' as 'idle' | 'paused' | 'fetching',
  error: null as Error | null,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback: string) => fallback,
  }),
}));
vi.mock('@/hooks/useWebhookSubscriptions', () => ({
  useWebhookDeliveries: () => history,
}));

import { DeliveryHistoryPanel } from './DeliveryHistoryPanel';

// Synthetic demo delivery. The event name is what the history shows once the
// read arrives. It must not be treated as absent before that.
const DEMO_DELIVERY = {
  id: 'del-demo-1',
  event: 'lead.created',
  statusCode: 503,
  success: false,
  durationMs: 80,
  attempt: 1,
  errorMessage: null,
  createdAt: '2026-11-07T12:00:00.000Z',
};

const CHECKING = 'Checking delivery history. It has not arrived.';
const FAILED_TITLE = 'Failed to load';
const FAILED = 'Could not load delivery history.';
const EMPTY = 'No deliveries recorded yet.';
const EMPTY_LIE = /no deliveries|recorded yet|history is empty|all clear|idle/i;

function setHistory(next: Partial<typeof history>) {
  history.data = undefined;
  history.isPending = false;
  history.isLoading = false;
  history.isFetching = false;
  history.isPaused = false;
  history.isError = false;
  history.fetchStatus = 'idle';
  history.error = null;
  Object.assign(history, next);
}

function renderHistory() {
  return render(<DeliveryHistoryPanel subscriptionId="sub-demo-1" id="deliveries-sub-demo-1" />);
}

function expectNotEmpty() {
  expect(screen.queryByText(EMPTY)).toBeNull();
  expect(screen.queryByText(EMPTY_LIE)).toBeNull();
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.queryByText(DEMO_DELIVERY.event)).toBeNull();
}

describe('DeliveryHistoryPanel read', () => {
  beforeEach(() => {
    setHistory({ isPending: true, fetchStatus: 'idle' });
  });

  afterEach(() => {
    cleanup();
  });

  it('does not call an unread delivery history empty', () => {
    // WHY: the history paints as soon as the endpoint is expanded. fetchStatus
    // is idle and isLoading is false, so "No deliveries recorded yet" looks
    // like the history was read and found clear. The synthetic lead.created
    // attempt has not been read. That is not an empty history.
    setHistory({ isPending: true, isLoading: false, isPaused: false, fetchStatus: 'idle' });
    renderHistory();

    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.getByText(CHECKING)).toBeTruthy();
    expectNotEmpty();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(FAILED_TITLE)).toBeNull();
  });

  it('does not call a paused delivery history empty', () => {
    // WHY: a paused read (offline demo tab) has no rows. isLoading is false
    // because the fetch is not running. The empty sentence would say this
    // endpoint already has no deliveries.
    setHistory({
      isPending: true,
      isLoading: false,
      isFetching: false,
      isPaused: true,
      fetchStatus: 'paused',
    });
    renderHistory();

    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.getByText(CHECKING)).toBeTruthy();
    expectNotEmpty();
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it('does not call an in-flight delivery history empty', () => {
    // WHY: the first fetch is the same unread history. A skeleton is not a
    // result, and "No deliveries recorded yet" is a history that arrived empty.
    setHistory({
      isPending: true,
      isLoading: true,
      isFetching: true,
      isPaused: false,
      fetchStatus: 'fetching',
    });
    renderHistory();

    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.getByText(CHECKING)).toBeTruthy();
    expectNotEmpty();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(FAILED_TITLE)).toBeNull();
  });

  it('keeps a failed history on the failure sentence', () => {
    // WHY: a failed read with no payload is a failed read. It is not a history
    // that arrived empty, and it is not still checking.
    setHistory({ isError: true, error: new Error('Delivery history unavailable') });
    renderHistory();

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED_TITLE)).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(DEMO_DELIVERY.event)).toBeNull();
  });

  it('keeps a settled empty history empty', () => {
    // WHY: a read that arrived with no rows really has no deliveries. That
    // sentence is the result, not a payload that has not arrived.
    setHistory({ data: { data: [], hasMore: false } });
    renderHistory();

    expect(screen.getByText(EMPTY)).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it('keeps a loaded synthetic delivery on the history', () => {
    // WHY: a payload that arrived, including one demo lead.created attempt, is
    // the history. The hold is only for a read that has not arrived.
    setHistory({ data: { data: [DEMO_DELIVERY], hasMore: false } });
    renderHistory();

    expect(screen.getByRole('table')).toBeTruthy();
    expect(screen.getByText(DEMO_DELIVERY.event)).toBeTruthy();
    expect(screen.getByText('503')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
  });

  it('keeps a loaded history when a later read fails', () => {
    // WHY: a refresh that fails does not erase attempts already on screen.
    // The failure sentence is for a read that never arrived.
    setHistory({
      data: { data: [DEMO_DELIVERY], hasMore: false },
      isError: true,
      isFetching: false,
      error: new Error('Delivery history unavailable'),
    });
    renderHistory();

    expect(screen.getByText(DEMO_DELIVERY.event)).toBeTruthy();
    expect(screen.getByText('503')).toBeTruthy();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(FAILED_TITLE)).toBeNull();
    expect(screen.queryByText('Delivery history unavailable')).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });
});

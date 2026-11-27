// The message log lists webhook deliveries for the open filters. Until that
// read arrives, the rows are not a settled result. A paused read has no
// payload and isLoading is false, so the log says "No messages match these
// filters." An in-flight read is the same unread list. That sentence is for
// a log that arrived empty. It is not an empty log, and the failure sentence
// would say the log is missing.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const list = vi.hoisted(() => ({
  data: undefined as
    | {
        items: Array<{
          id: string;
          subscriptionId: string;
          url: string;
          event: string;
          status: 'succeeded' | 'failed' | 'pending';
          attempts: number;
          lastStatusCode: number | null;
          lastDurationMs: number | null;
          replayOfId: string | null;
          createdAt: string;
        }>;
        nextCursor: string | null;
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
vi.mock('@/hooks/useWebhookDeliveries', () => ({
  useWebhookMessages: () => list,
  useWebhookMessage: () => ({ data: undefined, isLoading: false, isError: false }),
  useReplayWebhookMessage: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/hooks/useCapabilities', () => ({ useHasPermission: () => false }));
vi.mock('@/components/ui/Toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { MessageLog } from './MessageLog';

// Synthetic demo delivery. example.test is not a person. The row is what the
// log shows once the read arrives. It must not be treated as absent before that.
const DEMO_MESSAGE = {
  id: 'msg-demo-1',
  subscriptionId: 'sub-demo-1',
  url: 'https://hooks.example.test/polo',
  event: 'lead.created',
  status: 'failed' as const,
  attempts: 2,
  lastStatusCode: 503,
  lastDurationMs: 1200,
  replayOfId: null,
  createdAt: '2026-11-07T12:00:00.000Z',
};

const CHECKING = 'Checking the message log. It has not arrived.';
const FAILED = 'Could not load the message log. Refresh to try again.';
const EMPTY = 'No messages match these filters.';
const EMPTY_LIE = /no messages|message log is empty|log is missing|all clear/i;

function setList(next: Partial<typeof list>) {
  list.data = undefined;
  list.isPending = false;
  list.isLoading = false;
  list.isFetching = false;
  list.isPaused = false;
  list.isError = false;
  list.fetchStatus = 'idle';
  list.error = null;
  Object.assign(list, next);
}

function expectNotEmptyOrMissing() {
  expect(screen.queryByText(EMPTY)).toBeNull();
  expect(screen.queryByText(EMPTY_LIE)).toBeNull();
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.queryByText(DEMO_MESSAGE.event)).toBeNull();
  expect(screen.queryByText('hooks.example.test')).toBeNull();
}

describe('MessageLog read', () => {
  beforeEach(() => {
    setList({ isPending: true, fetchStatus: 'idle' });
  });

  afterEach(() => {
    cleanup();
  });

  it('does not call an unread message log empty', () => {
    // WHY: the demo log paints before the request starts. fetchStatus is idle
    // and isLoading is false, so "No messages match these filters" looks like
    // a log that was read and found clear. The synthetic lead.created delivery
    // has not been read. That is not an empty log and not a missing log.
    setList({ isPending: true, isLoading: false, isPaused: false, fetchStatus: 'idle' });
    render(<MessageLog filters={{}} />);

    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.getByText(CHECKING)).toBeTruthy();
    expectNotEmptyOrMissing();
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it('does not call a paused message log empty', () => {
    // WHY: a paused read (offline demo tab) has no rows. isLoading is false
    // because the fetch is not running. The empty sentence would say the
    // filters already matched nothing, including the synthetic delivery.
    setList({
      isPending: true,
      isLoading: false,
      isFetching: false,
      isPaused: true,
      fetchStatus: 'paused',
    });
    render(<MessageLog filters={{}} />);

    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.getByText(CHECKING)).toBeTruthy();
    expectNotEmptyOrMissing();
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it('does not call an in-flight message log empty', () => {
    // WHY: the first fetch is the same unread log. "Loading messages" is not
    // a result, and "No messages match these filters" is a log that arrived
    // empty. Hiding the log would say it is missing.
    setList({
      isPending: true,
      isLoading: true,
      isFetching: true,
      isPaused: false,
      fetchStatus: 'fetching',
    });
    render(<MessageLog filters={{}} />);

    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText('Loading messages…')).toBeNull();
    expectNotEmptyOrMissing();
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it('does not call a failed message log a missing log', () => {
    // WHY: a failed read is not a filter that matched nothing and not a log
    // that disappeared. The empty sentence would hide the failure.
    setList({ isError: true, error: new Error('Message log unavailable') });
    render(<MessageLog filters={{}} />);

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByText(DEMO_MESSAGE.event)).toBeNull();
  });

  it('keeps a settled empty log empty', () => {
    // WHY: a read that arrived with no rows really has nothing for these
    // filters. That sentence is the result, not a payload that has not arrived.
    setList({ data: { items: [], nextCursor: null } });
    render(<MessageLog filters={{}} />);

    expect(screen.getByText(EMPTY)).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it('keeps a loaded synthetic delivery on the log', () => {
    // WHY: a payload that arrived, including one demo lead.created row, is the
    // log. The hold is only for a read that has not arrived.
    setList({ data: { items: [DEMO_MESSAGE], nextCursor: null } });
    render(<MessageLog filters={{}} />);

    expect(screen.getByRole('table')).toBeTruthy();
    expect(screen.getByText(DEMO_MESSAGE.event)).toBeTruthy();
    expect(screen.getByText('hooks.example.test')).toBeTruthy();
    expect(screen.getByText('Failed')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
  });

  it('keeps a loaded log when a later read fails', () => {
    // WHY: a refresh that fails does not erase deliveries already on screen.
    // The failure sentence is for a read that never arrived.
    setList({
      data: { items: [DEMO_MESSAGE], nextCursor: null },
      isError: true,
      isFetching: false,
      error: new Error('Message log unavailable'),
    });
    render(<MessageLog filters={{}} />);

    expect(screen.getByText(DEMO_MESSAGE.event)).toBeTruthy();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText('Message log unavailable')).toBeNull();
    expect(screen.queryByText(EMPTY)).toBeNull();
  });
});

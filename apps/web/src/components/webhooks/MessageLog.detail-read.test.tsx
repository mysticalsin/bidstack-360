// Opening one row asks for that delivery. Until the detail arrives, the drawer
// is not a missing message. A paused read has no payload and isLoading is
// false, so the drawer says "Could not load this message." An in-flight read
// only says "Loading attempts…". That failure sentence is for a detail that
// failed. It is not a detail that has not arrived.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const detail = vi.hoisted(() => ({
  data: undefined as
    | {
        message: {
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
        };
        requestBody: string;
        requestBodyTruncated: boolean;
        attempts: Array<{
          id: string;
          attempt: number;
          statusCode: number | null;
          success: boolean;
          durationMs: number | null;
          errorMessage: string | null;
          requestHeaders: Record<string, string>;
          responseBody: string | null;
          responseTruncated: boolean;
          createdAt: string;
        }>;
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
    t: (_k: string, fallback: string, vars?: Record<string, unknown>) =>
      fallback.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(vars?.[name] ?? '')),
  }),
}));
vi.mock('@/hooks/useWebhookDeliveries', () => ({
  useWebhookMessages: () => ({
    data: {
      items: [
        {
          id: 'msg-demo-1',
          subscriptionId: 'sub-demo-1',
          url: 'https://hooks.example.test/polo',
          event: 'lead.created',
          status: 'failed' as const,
          attempts: 1,
          lastStatusCode: 503,
          lastDurationMs: 1200,
          replayOfId: null,
          createdAt: '2026-11-07T12:00:00.000Z',
        },
      ],
      nextCursor: null,
    },
    isLoading: false,
    isError: false,
  }),
  useWebhookMessage: () => detail,
  useReplayWebhookMessage: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/hooks/useCapabilities', () => ({ useHasPermission: () => false }));
vi.mock('@/components/ui/Toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { MessageLog } from './MessageLog';

// Synthetic demo delivery. example.test is not a person. The body is what the
// drawer shows once the detail arrives. It must not be treated as missing
// before that.
const DEMO_BODY = '{"id":"msg-demo-1","event":"lead.created"}';

const CHECKING = 'Checking this message. It has not arrived.';
const FAILED = 'Could not load this message.';
const LOADING = 'Loading attempts…';

function setDetail(next: Partial<typeof detail>) {
  detail.data = undefined;
  detail.isPending = false;
  detail.isLoading = false;
  detail.isFetching = false;
  detail.isPaused = false;
  detail.isError = false;
  detail.fetchStatus = 'idle';
  detail.error = null;
  Object.assign(detail, next);
}

function loadedDetail() {
  return {
    message: {
      id: 'msg-demo-1',
      subscriptionId: 'sub-demo-1',
      url: 'https://hooks.example.test/polo',
      event: 'lead.created',
      status: 'failed' as const,
      attempts: 1,
      lastStatusCode: 503,
      lastDurationMs: 1200,
      replayOfId: null,
      createdAt: '2026-11-07T12:00:00.000Z',
    },
    requestBody: DEMO_BODY,
    requestBodyTruncated: false,
    attempts: [
      {
        id: 'att-demo-1',
        attempt: 1,
        statusCode: 503,
        success: false,
        durationMs: 1200,
        errorMessage: null,
        requestHeaders: { 'X-Polo-Signature': 't=1700000000,v1=****' },
        responseBody: '{"error":"demo"}',
        responseTruncated: false,
        createdAt: '2026-11-07T12:00:01.000Z',
      },
    ],
  };
}

async function openDrawer() {
  render(<MessageLog filters={{}} />);
  fireEvent.click(screen.getByRole('button', { name: /Open lead\.created/ }));
  return screen.findByRole('dialog');
}

describe('MessageLog detail read', () => {
  beforeEach(() => {
    setDetail({ isPending: true, fetchStatus: 'idle' });
  });

  afterEach(() => {
    cleanup();
  });

  it('does not call an unread message detail missing', async () => {
    // WHY: the drawer paints as soon as the row is opened. fetchStatus is idle
    // and isLoading is false, so "Could not load this message" looks like the
    // synthetic lead.created delivery was looked up and is gone. That read has
    // not started.
    setDetail({ isPending: true, isLoading: false, isPaused: false, fetchStatus: 'idle' });
    const drawer = await openDrawer();

    expect(within(drawer).getByRole('status')).toBeTruthy();
    expect(within(drawer).getByText(CHECKING)).toBeTruthy();
    expect(within(drawer).queryByText(FAILED)).toBeNull();
    expect(within(drawer).queryByText(LOADING)).toBeNull();
    expect(within(drawer).queryByText(DEMO_BODY)).toBeNull();
    expect(within(drawer).queryByText('Attempt 1')).toBeNull();
  });

  it('does not call a paused message detail missing', async () => {
    // WHY: a paused read (offline demo tab) has no body. isLoading is false
    // because the fetch is not running. The failure sentence would say this
    // message could not be loaded.
    setDetail({
      isPending: true,
      isLoading: false,
      isFetching: false,
      isPaused: true,
      fetchStatus: 'paused',
    });
    const drawer = await openDrawer();

    expect(within(drawer).getByRole('status')).toBeTruthy();
    expect(within(drawer).getByText(CHECKING)).toBeTruthy();
    expect(within(drawer).queryByText(FAILED)).toBeNull();
    expect(within(drawer).queryByText(DEMO_BODY)).toBeNull();
  });

  it('does not call an in-flight message detail missing', async () => {
    // WHY: the first fetch is the same unread detail. "Loading attempts" is
    // not a result, and "Could not load this message" is a detail that failed.
    setDetail({
      isPending: true,
      isLoading: true,
      isFetching: true,
      isPaused: false,
      fetchStatus: 'fetching',
    });
    const drawer = await openDrawer();

    expect(within(drawer).getByRole('status')).toBeTruthy();
    expect(within(drawer).getByText(CHECKING)).toBeTruthy();
    expect(within(drawer).queryByText(LOADING)).toBeNull();
    expect(within(drawer).queryByText(FAILED)).toBeNull();
    expect(within(drawer).queryByText(DEMO_BODY)).toBeNull();
    expect(within(drawer).queryByText('Attempt 1')).toBeNull();
  });

  it('keeps a failed detail on the failure sentence', async () => {
    // WHY: a failed read with no payload is a failed read. It is not a message
    // that arrived empty, and it is not still checking.
    setDetail({ isError: true, error: new Error('Message detail unavailable') });
    const drawer = await openDrawer();

    expect(within(drawer).getByRole('alert')).toBeTruthy();
    expect(within(drawer).getByText(FAILED)).toBeTruthy();
    expect(within(drawer).queryByText(CHECKING)).toBeNull();
    expect(within(drawer).queryByText(DEMO_BODY)).toBeNull();
    expect(within(drawer).queryByText('Attempt 1')).toBeNull();
  });

  it('keeps a loaded synthetic delivery in the drawer', async () => {
    // WHY: a payload that arrived, including one demo lead.created body, is the
    // message. The hold is only for a read that has not arrived.
    setDetail({ data: loadedDetail() });
    const drawer = await openDrawer();

    expect(within(drawer).getByText(DEMO_BODY)).toBeTruthy();
    expect(within(drawer).getByText('Attempt 1')).toBeTruthy();
    expect(within(drawer).getByText('hooks.example.test')).toBeTruthy();
    expect(within(drawer).queryByText(CHECKING)).toBeNull();
    expect(within(drawer).queryByText(FAILED)).toBeNull();
  });

  it('keeps a loaded message when a later read fails', async () => {
    // WHY: a refresh that fails does not erase a delivery already on screen.
    // The failure sentence is for a read that never arrived.
    setDetail({
      data: loadedDetail(),
      isError: true,
      isFetching: false,
      error: new Error('Message detail unavailable'),
    });
    const drawer = await openDrawer();

    expect(within(drawer).getByText(DEMO_BODY)).toBeTruthy();
    expect(within(drawer).getByText('Attempt 1')).toBeTruthy();
    expect(within(drawer).queryByText(FAILED)).toBeNull();
    expect(within(drawer).queryByText('Message detail unavailable')).toBeNull();
    expect(within(drawer).queryByText(CHECKING)).toBeNull();
  });
});

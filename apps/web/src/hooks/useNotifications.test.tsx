// Regression coverage for the notifications silent-failure bug: a rejected
// mark-read / mark-all-read mutation must surface a toast. Without onError
// wired here, clicking a notification or "Mark all read" appeared to do
// nothing, indistinguishable from the feature being broken.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import { api, ApiError } from '@/lib/api';
import { toast } from '@/components/ui/Toast';
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
} from './useNotifications';

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: vi.fn() };
});

vi.mock('@/components/ui/Toast', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useNotifications mutation error surfacing', () => {
  beforeEach(() => {
    vi.mocked(api).mockReset();
    vi.mocked(toast.error).mockClear();
  });

  it('toasts the server message when marking a notification read is rejected', async () => {
    vi.mocked(api).mockRejectedValue(new ApiError('Notification not found', 404, null));
    const { result } = renderHook(() => useMarkNotificationRead(), { wrapper: makeWrapper() });

    await expect(result.current.mutateAsync('notif-1')).rejects.toThrow();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Notification not found'));
  });

  it('toasts the server message when marking all notifications read is rejected', async () => {
    vi.mocked(api).mockRejectedValue(new ApiError('Server error', 500, null));
    const { result } = renderHook(() => useMarkAllNotificationsRead(), {
      wrapper: makeWrapper(),
    });

    await expect(result.current.mutateAsync()).rejects.toThrow();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Server error'));
  });
});

const DEMO_ALERT = {
  id: 'ntf_demo_stage',
  type: 'stage_change' as const,
  title: 'Synthetic bid moved to proposal',
  body: 'Demo record only',
  entityType: 'opportunity',
  entityId: 'opp_demo_1',
  url: '/opportunities/opp_demo_1',
  readAt: null,
  createdAt: '2026-11-25T12:00:00.000Z',
};

function badgeHarness() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClient.setQueryData(['notifications'], { unread: 1, items: [DEMO_ALERT] });
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return { queryClient, wrapper };
}

describe('notification badge on the phone bell', () => {
  beforeEach(() => {
    vi.mocked(api).mockReset();
    vi.mocked(toast.error).mockClear();
  });

  it('drops the unread count when a synthetic alert is opened, before the list reloads', async () => {
    // WHY: the phone bell is the only unread signal while the tray is shut.
    // Opening the alert marks it read, but the badge waited on the list reload.
    // A reload that never returns left the bell saying the demo alert was still new.
    const { queryClient, wrapper } = badgeHarness();
    let release: (row: unknown) => void = () => {};
    vi.mocked(api).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const { result } = renderHook(() => useMarkNotificationRead(), { wrapper });

    const pending = result.current.mutateAsync(DEMO_ALERT.id);

    await waitFor(() => {
      expect(queryClient.getQueryData<{ unread: number }>(['notifications'])?.unread).toBe(0);
    });

    release({ ...DEMO_ALERT, readAt: '2026-11-25T12:05:00.000Z' });
    await pending;

    const page = queryClient.getQueryData<{
      unread: number;
      items: Array<{ id: string; readAt: string | null }>;
    }>(['notifications']);
    expect(page?.unread).toBe(0);
    expect(page?.items[0]?.readAt).not.toBeNull();
  });

  it('puts the unread count back when the mark-read call fails', async () => {
    // WHY: a rejected read must not clear the bell. The rep still has the alert.
    const { queryClient, wrapper } = badgeHarness();
    vi.mocked(api).mockRejectedValue(new ApiError('Notification not found', 404, null));
    const { result } = renderHook(() => useMarkNotificationRead(), { wrapper });

    await expect(result.current.mutateAsync(DEMO_ALERT.id)).rejects.toThrow();

    expect(queryClient.getQueryData<{ unread: number }>(['notifications'])?.unread).toBe(1);
    expect(toast.error).toHaveBeenCalledWith('Notification not found');
  });

  it('drops the badge when every alert is marked read and the list reload fails', async () => {
    // WHY: Mark all read on the phone tray has to clear the bell even when the
    // follow-up list request fails. Otherwise the tray can show no new work
    // while the badge still counts the synthetic alert.
    const { queryClient, wrapper } = badgeHarness();
    vi.mocked(api).mockImplementation(async (url: string) => {
      if (String(url).includes('read-all')) return { updated: 1 };
      throw new ApiError('Could not load notifications', 500, null);
    });
    const { result } = renderHook(
      () => ({ markAll: useMarkAllNotificationsRead(), list: useNotifications() }),
      { wrapper },
    );

    await result.current.markAll.mutateAsync();
    await waitFor(() => expect(result.current.list.isError).toBe(true));

    expect(result.current.list.data?.unread).toBe(0);
    expect(queryClient.getQueryData<{ unread: number }>(['notifications'])?.unread).toBe(0);
  });
});

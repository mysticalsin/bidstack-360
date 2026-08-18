// Regression coverage for the notifications silent-failure bug: a rejected
// mark-read / mark-all-read mutation must surface a toast. Without onError
// wired here, clicking a notification or "Mark all read" appeared to do
// nothing, indistinguishable from the feature being broken.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api, ApiError } from '@/lib/api';
import { toast } from '@/components/ui/Toast';
import { useMarkAllNotificationsRead, useMarkNotificationRead } from './useNotifications';

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

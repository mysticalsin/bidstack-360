// Regression coverage for the "add widget" / "create dashboard" silent-failure
// bug: a rejected mutation (e.g. a 403 from a role without reports:write, or a
// transient 5xx) must surface a toast. Without onError wired here, the caller
// saw nothing at all — clicking "Save widget" or "Create" appeared to do
// nothing, indistinguishable from the feature being broken.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api, ApiError } from '@/lib/api';
import { toast } from '@/components/ui/Toast';
import { useAddWidget, useCreateDashboard, useDeleteDashboard, useDeleteWidget } from './useDashboards';

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

describe('useDashboards mutation error surfacing', () => {
  beforeEach(() => {
    vi.mocked(api).mockReset();
    vi.mocked(toast.error).mockClear();
  });

  it('toasts the server message when creating a dashboard is rejected (e.g. 403 without reports:write)', async () => {
    vi.mocked(api).mockRejectedValue(new ApiError('reports:write required', 403, null));
    const { result } = renderHook(() => useCreateDashboard(), { wrapper: makeWrapper() });

    await expect(
      result.current.mutateAsync({ name: 'My Pipeline' }),
    ).rejects.toThrow();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('reports:write required'));
  });

  it('toasts the server message when adding a widget is rejected', async () => {
    vi.mocked(api).mockRejectedValue(new ApiError('Widget config invalid', 500, null));
    const { result } = renderHook(() => useAddWidget('dash-1'), { wrapper: makeWrapper() });

    await expect(
      result.current.mutateAsync({ title: 'Pipeline value', type: 'bar' }),
    ).rejects.toThrow();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Widget config invalid'));
  });

  it('toasts the server message when deleting a dashboard is rejected (e.g. stale row or 403)', async () => {
    vi.mocked(api).mockRejectedValue(new ApiError('Dashboard not found', 404, null));
    const { result } = renderHook(() => useDeleteDashboard(), { wrapper: makeWrapper() });

    await expect(result.current.mutateAsync('dash-1')).rejects.toThrow();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Dashboard not found'));
  });

  it('toasts the server message when deleting a widget is rejected', async () => {
    vi.mocked(api).mockRejectedValue(new ApiError('Widget not found', 404, null));
    const { result } = renderHook(() => useDeleteWidget('dash-1'), { wrapper: makeWrapper() });

    await expect(result.current.mutateAsync('widget-1')).rejects.toThrow();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Widget not found'));
  });
});

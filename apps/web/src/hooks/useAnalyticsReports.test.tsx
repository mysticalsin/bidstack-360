// Regression coverage for the "run / duplicate / delete report" silent-failure
// bug: a rejected mutation (e.g. a 404 when the report was deleted in another
// tab, or a transient 5xx) must surface a toast. Without onError wired here,
// the caller saw nothing at all — the Play/Duplicate/Delete buttons on the
// reports list appeared to succeed (spinner just stopped) while nothing
// actually happened.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api, ApiError } from '@/lib/api';
import { toast } from '@/components/ui/Toast';
import { useDuplicateReport, useDeleteReport, useRunReport } from './useAnalyticsReports';

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

describe('useAnalyticsReports mutation error surfacing', () => {
  beforeEach(() => {
    vi.mocked(api).mockReset();
    vi.mocked(toast.error).mockClear();
  });

  it('toasts the server message when running a report is rejected (e.g. 404 after it was deleted elsewhere)', async () => {
    vi.mocked(api).mockRejectedValue(new ApiError('Report not found', 404, null));
    const { result } = renderHook(() => useRunReport(), { wrapper: makeWrapper() });

    await expect(result.current.mutateAsync({ id: 'report-1' })).rejects.toThrow();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Report not found'));
  });

  it('toasts the server message when duplicating a report is rejected', async () => {
    vi.mocked(api).mockRejectedValue(new ApiError('Report not found', 404, null));
    const { result } = renderHook(() => useDuplicateReport(), { wrapper: makeWrapper() });

    await expect(result.current.mutateAsync('report-1')).rejects.toThrow();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Report not found'));
  });

  it('toasts the server message when deleting a report is rejected', async () => {
    vi.mocked(api).mockRejectedValue(new ApiError('Report not found', 404, null));
    const { result } = renderHook(() => useDeleteReport(), { wrapper: makeWrapper() });

    await expect(result.current.mutateAsync('report-1')).rejects.toThrow();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Report not found'));
  });
});

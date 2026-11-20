// A failed account intel refresh (network error, 403, 429, or a refresh the
// API could not queue) must tell the user instead of re-enabling the button
// in silence.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api, ApiError } from '@/lib/api';
import { toast } from '@/components/ui/Toast';
import { useRefreshIntelSource } from './useCompanyIntel';

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

const notQueued = {
  queued: false,
  source: 'hiring',
  status: { key: 'hiring', label: 'Job boards', status: 'ok', lastFetchedAt: null, result: { new: 0, updated: 0, skipped: 0, failed: 0 }, detail: null },
};

describe('useRefreshIntelSource error surfacing', () => {
  beforeEach(() => {
    vi.mocked(api).mockReset();
    vi.mocked(toast.error).mockClear();
  });

  it('toasts when the refresh is rate limited', async () => {
    vi.mocked(api).mockRejectedValue(new ApiError('Too Many Requests', 429, null));
    const { result } = renderHook(() => useRefreshIntelSource('c1'), { wrapper: makeWrapper() });
    await expect(result.current.mutateAsync('hiring')).rejects.toThrow();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Too many refreshes. Try again in a minute.'));
  });

  it('treats a response that was not queued as a failure', async () => {
    vi.mocked(api).mockResolvedValue(notQueued);
    const { result } = renderHook(() => useRefreshIntelSource('c1'), { wrapper: makeWrapper() });
    await expect(result.current.mutateAsync('hiring')).rejects.toThrow(/could not be queued/);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Job boards refresh could not be queued. Try again in a minute.'));
    expect(result.current.pollUntil).toBeUndefined();
  });
});

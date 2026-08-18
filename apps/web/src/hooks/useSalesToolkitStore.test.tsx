// Regression coverage for the Sales Toolkit library silent-failure bug: a
// rejected create/update/delete mutation (e.g. a 400 missing-title or a 404
// on delete) must surface a toast. Without onError wired here, Save/Delete
// on the Toolkit library failed completely silently.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api, ApiError } from '@/lib/api';
import { toast } from '@/components/ui/Toast';
import { useCreateToolkit, useDeleteToolkit, useUpdateToolkit } from './useSalesToolkitStore';

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

describe('useSalesToolkitStore mutation error surfacing', () => {
  beforeEach(() => {
    vi.mocked(api).mockReset();
    vi.mocked(toast.error).mockClear();
  });

  it('toasts the server message when creating a toolkit is rejected (e.g. 400 missing title)', async () => {
    vi.mocked(api).mockRejectedValue(new ApiError('body/title Required', 400, null));
    const { result } = renderHook(() => useCreateToolkit(), { wrapper: makeWrapper() });

    await expect(
      result.current.mutateAsync({
        title: '',
        description: null,
        category: 'deck',
        sectorTags: [],
        url: null,
      }),
    ).rejects.toThrow();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('body/title Required'));
  });

  it('toasts the server message when updating a toolkit is rejected', async () => {
    vi.mocked(api).mockRejectedValue(new ApiError('Toolkit not found', 404, null));
    const { result } = renderHook(() => useUpdateToolkit(), { wrapper: makeWrapper() });

    await expect(
      result.current.mutateAsync({ id: 'tk-1', patch: { title: 'Updated' } }),
    ).rejects.toThrow();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Toolkit not found'));
  });

  it('toasts the server message when deleting a toolkit is rejected (e.g. 404 on stale row)', async () => {
    vi.mocked(api).mockRejectedValue(new ApiError('Toolkit not found', 404, null));
    const { result } = renderHook(() => useDeleteToolkit(), { wrapper: makeWrapper() });

    await expect(result.current.mutateAsync('tk-1')).rejects.toThrow();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Toolkit not found'));
  });
});

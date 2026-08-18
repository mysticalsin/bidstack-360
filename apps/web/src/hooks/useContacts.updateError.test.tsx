// Regression coverage for the silent-revert bug: useUpdateContact only rolled
// back its optimistic write on a rejected PATCH — it never told the user why
// the cell snapped back (e.g. two tabs open, one deletes the contact while
// the other still has the row and edits a cell -> 404). Without onError
// wired to toast, the revert was indistinguishable from nothing happening.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { toast } from '@/components/ui/Toast';
import { api, ApiError } from '@/lib/api';
import { useUpdateContact } from './useContacts';

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

describe('useUpdateContact mutation error surfacing', () => {
  beforeEach(() => {
    vi.mocked(api).mockReset();
    vi.mocked(toast.error).mockClear();
  });

  it('toasts the server message when an inline edit PATCH is rejected (e.g. stale/deleted contact)', async () => {
    vi.mocked(api).mockRejectedValue(new ApiError('Contact not found', 404, null));
    const { result } = renderHook(() => useUpdateContact(), { wrapper: makeWrapper() });

    await expect(
      result.current.mutateAsync({ id: 'c-1', patch: { role: 'CFO' } }),
    ).rejects.toThrow();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Contact not found'));
  });

  it('falls back to a generic message when the rejection is not an Error', async () => {
    vi.mocked(api).mockRejectedValue('network down');
    const { result } = renderHook(() => useUpdateContact(), { wrapper: makeWrapper() });

    await expect(
      result.current.mutateAsync({ id: 'c-1', patch: { influence: 3 } }),
    ).rejects.toBeDefined();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not update contact'));
  });
});

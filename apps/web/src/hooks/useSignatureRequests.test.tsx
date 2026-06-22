import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/lib/api';
import { useBulkVoidSignatures } from './useSignatureRequests';

vi.mock('@/lib/api', () => ({
  api: vi.fn(),
}));

function createHarness() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('useBulkVoidSignatures', () => {
  it('attempts every id and reports a partial failure instead of aborting on the first error', async () => {
    // WHY this matters: the previous Promise.all rejected on the first failing
    // void, so the remaining requests were never awaited and the user could not
    // tell which records actually voided. allSettled must attempt all three and
    // surface a per-id success/failure summary.
    const { wrapper } = createHarness();
    vi.mocked(api)
      .mockResolvedValueOnce({ id: 'a' }) // a → ok
      .mockRejectedValueOnce(new Error('already voided')) // b → fail
      .mockResolvedValueOnce({ id: 'c' }); // c → ok

    const { result } = renderHook(() => useBulkVoidSignatures(), { wrapper });

    let summary!: Awaited<ReturnType<typeof result.current.mutateAsync>>;
    await act(async () => {
      summary = await result.current.mutateAsync({ ids: ['a', 'b', 'c'], reason: 'duplicate' });
    });

    // All three were attempted (not short-circuited at the first failure).
    expect(api).toHaveBeenCalledTimes(3);
    expect(summary.succeeded).toEqual(['a', 'c']);
    expect(summary.failed).toEqual([{ id: 'b', error: 'already voided' }]);
  });

  it('invalidates the signature list query even when some voids fail', async () => {
    const { queryClient, wrapper } = createHarness();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    vi.mocked(api)
      .mockResolvedValueOnce({ id: 'a' })
      .mockRejectedValueOnce(new Error('boom'));

    const { result } = renderHook(() => useBulkVoidSignatures(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ ids: ['a', 'b'], reason: 'mistake' });
    });

    // The 'a' void changed server state, so the list must refresh regardless of
    // 'b' failing — onSettled, not onSuccess.
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['signature-requests'] });
  });
});

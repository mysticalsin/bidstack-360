// Regression coverage for the account-intel silent-failure bug: a rejected
// delete (e.g. a stale solution/product id, or a 403) must surface a toast.
// Without onError wired here, removing a row in ReviewStep/AccountIntelPanel
// just stopped the spinner with zero feedback.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api, ApiError } from '@/lib/api';
import { toast } from '@/components/ui/Toast';
import { useDeleteSolution, useDeleteProduct } from './useAccountIntel';

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

describe('useAccountIntel mutation error surfacing', () => {
  beforeEach(() => {
    vi.mocked(api).mockReset();
    vi.mocked(toast.error).mockClear();
  });

  it('toasts the server message when deleting a solution is rejected', async () => {
    vi.mocked(api).mockRejectedValue(new ApiError('Solution not found', 404, null));
    const { result } = renderHook(() => useDeleteSolution('account-1'), {
      wrapper: makeWrapper(),
    });

    await expect(result.current.mutateAsync('solution-1')).rejects.toThrow();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Solution not found'));
  });

  it('toasts the server message when deleting a product is rejected', async () => {
    vi.mocked(api).mockRejectedValue(new ApiError('Product not found', 404, null));
    const { result } = renderHook(() => useDeleteProduct('account-1'), {
      wrapper: makeWrapper(),
    });

    await expect(result.current.mutateAsync('product-1')).rejects.toThrow();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Product not found'));
  });
});

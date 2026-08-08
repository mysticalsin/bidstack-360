// Regression coverage for the "suggest recovery plays" silent-failure bug: a
// rejected mutation must surface a toast. RotBadge.onOpen awaits
// mutateAsync with no catch of its own — without onError here, the recovery
// menu just stayed open and empty with zero feedback.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api, ApiError } from '@/lib/api';
import { toast } from '@/components/ui/Toast';
import { useRecoverySuggest } from './useLeadRot';

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

describe('useLeadRot mutation error surfacing', () => {
  beforeEach(() => {
    vi.mocked(api).mockReset();
    vi.mocked(toast.error).mockClear();
  });

  it('toasts the server message when suggesting recovery plays is rejected (e.g. 500)', async () => {
    vi.mocked(api).mockRejectedValue(new ApiError('Recovery model unavailable', 500, null));
    const { result } = renderHook(() => useRecoverySuggest(), { wrapper: makeWrapper() });

    await expect(result.current.mutateAsync('lead-1')).rejects.toThrow();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Recovery model unavailable'));
  });
});

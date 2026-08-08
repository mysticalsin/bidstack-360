// Regression coverage for the reference-use silent-failure bug: a rejected
// "record use" mutation must surface a toast. Without onError wired here,
// clicking "Use in proposal" on ReferencesPage stopped the spinner with zero
// feedback.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api, ApiError } from '@/lib/api';
import { toast } from '@/components/ui/Toast';
import { useUseReference } from './useReferences';

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

describe('useReferences mutation error surfacing', () => {
  beforeEach(() => {
    vi.mocked(api).mockReset();
    vi.mocked(toast.error).mockClear();
  });

  it('toasts the server message when recording a reference use is rejected', async () => {
    vi.mocked(api).mockRejectedValue(new ApiError('Reference not found', 404, null));
    const { result } = renderHook(() => useUseReference(), { wrapper: makeWrapper() });

    await expect(result.current.mutateAsync('ref-1')).rejects.toThrow();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Reference not found'));
  });
});

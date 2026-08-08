// Regression coverage for the "enrich company" silent-failure bug: a
// rejected mutation (e.g. Apollo job dispatch failing) must surface a toast.
// PageHead.handleEnrich only wires onSuccess — without onError here, the
// "Enrich now" button just stopped spinning with zero feedback.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api, ApiError } from '@/lib/api';
import { toast } from '@/components/ui/Toast';
import { useEnrichCompany } from './useEnrichCompany';

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

describe('useEnrichCompany mutation error surfacing', () => {
  beforeEach(() => {
    vi.mocked(api).mockReset();
    vi.mocked(toast.error).mockClear();
  });

  it('toasts the server message when enrichment is rejected (e.g. 500 from the Apollo dispatch)', async () => {
    vi.mocked(api).mockRejectedValue(new ApiError('Enrichment provider unavailable', 500, null));
    const { result } = renderHook(() => useEnrichCompany(), { wrapper: makeWrapper() });

    await expect(
      result.current.mutateAsync({ id: 'company-1', name: 'Acme Corp' }),
    ).rejects.toThrow();

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Enrichment provider unavailable'),
    );
  });
});

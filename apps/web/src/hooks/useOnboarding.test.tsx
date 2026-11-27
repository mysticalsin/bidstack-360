import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { api } from '@/lib/api';
import { useChecklistProposalCount, useInstallTemplate, useDeleteSampleData } from './useOnboarding';

vi.mock('@/lib/api', () => ({ api: vi.fn(async () => ({})) }));

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useOnboarding mutations', () => {
  beforeEach(() => vi.mocked(api).mockClear());

  it('installs a template via POST to the keyed install route', async () => {
    const { result } = renderHook(() => useInstallTemplate(), { wrapper });
    result.current.mutate('B2B_SAAS');
    await waitFor(() => expect(api).toHaveBeenCalled());
    expect(api).toHaveBeenCalledWith('/api/onboarding/templates/B2B_SAAS/install', {
      method: 'POST',
    });
  });

  it('removes sample data via DELETE', async () => {
    const { result } = renderHook(() => useDeleteSampleData(), { wrapper });
    result.current.mutate();
    await waitFor(() => expect(api).toHaveBeenCalled());
    expect(api).toHaveBeenCalledWith('/api/onboarding/sample-data', { method: 'DELETE' });
  });

  it('reads the proposal total the checklist uses, not a full RFP page', async () => {
    // WHY: Quick Start must not call the RFP step done from a click when the
    // workspace already has responses, and it must not download the list to
    // find that out. One row is enough; `total` is the signal.
    vi.mocked(api).mockResolvedValue({ items: [{ id: 'p1' }], total: 6 });
    const { result } = renderHook(() => useChecklistProposalCount(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api).toHaveBeenCalledWith(
      '/api/v1/proposals?limit=1',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(result.current.data).toBe(6);
  });
});

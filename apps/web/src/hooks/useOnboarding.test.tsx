import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { api } from '@/lib/api';
import { useInstallTemplate, useDeleteSampleData } from './useOnboarding';

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
});

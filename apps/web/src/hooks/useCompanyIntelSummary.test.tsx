import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { api } from '@/lib/api';
import { useIntelImports } from './useCompanyIntelSummary';

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: vi.fn() };
});
vi.mock('@/components/ui/Toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const batch = (status: 'running' | 'complete') => ({
  id: 'b1',
  migrationJobId: null,
  origin: 'csv',
  total: 1,
  done: status === 'complete' ? 1 : 0,
  failed: 0,
  status,
  summary: {},
  createdAt: '2026-11-07T12:00:00.000Z',
  completedAt: status === 'complete' ? '2026-11-07T12:01:00.000Z' : null,
});

describe('useIntelImports', () => {
  it('refreshes the company list on the poll that sees a running batch complete', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    vi.mocked(api).mockResolvedValueOnce({ items: [batch('running')] });
    const { result } = renderHook(() => useIntelImports(), { wrapper });
    await waitFor(() => expect(result.current.data?.items[0]?.status).toBe('running'));
    invalidate.mockClear();

    vi.mocked(api).mockResolvedValueOnce({ items: [batch('complete')] });
    await result.current.refetch();

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['companies'] });
  });
});

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/lib/api';
import { useKeyAccounts } from './useKeyAccounts';

vi.mock('@/lib/api', () => ({
  api: vi.fn(async () => ({ items: [], nextCursor: 'next-key-page' })),
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useKeyAccounts pagination', () => {
  beforeEach(() => vi.mocked(api).mockClear());

  it('sends server-side filters with limit and cursor', async () => {
    renderHook(
      () =>
        useKeyAccounts({
          search: 'mantu',
          industry: 'Technology',
          ownerId: '11111111-1111-4111-8111-111111111111',
          limit: 50,
          cursor: 'cursor-50',
        }),
      { wrapper },
    );

    await waitFor(() => expect(api).toHaveBeenCalled());
    const calledPath = vi.mocked(api).mock.calls[0]![0] as string;
    expect(calledPath).toContain('search=mantu');
    expect(calledPath).toContain('industry=Technology');
    expect(calledPath).toContain('ownerId=11111111-1111-4111-8111-111111111111');
    expect(calledPath).toContain('limit=50');
    expect(calledPath).toContain('cursor=cursor-50');
  });

  it('surfaces nextCursor so the page can advance beyond the first slice', async () => {
    const { result } = renderHook(() => useKeyAccounts({ limit: 50 }), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.nextCursor).toBe('next-key-page');
  });
});

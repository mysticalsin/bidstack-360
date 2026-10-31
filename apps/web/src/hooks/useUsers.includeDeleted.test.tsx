import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

const api = vi.fn(async () => ({ items: [], nextCursor: null }));
vi.mock('@/lib/api', () => ({ api: (...a: unknown[]) => api(...(a as [])) }));
vi.mock('@/components/ui/Toast', () => ({ toast: vi.fn() }));

import { useUsers } from './useUsers';

const wrap = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

describe('useUsers includeDeleted', () => {
  it('asks for former members only when requested', async () => {
    const a = renderHook(() => useUsers({ limit: 200, includeDeleted: true }), { wrapper: wrap });
    await waitFor(() => expect(a.result.current.isSuccess).toBe(true));
    expect(api.mock.calls.at(-1)?.[0]).toBe('/api/users?limit=200&includeDeleted=true');
    const b = renderHook(() => useUsers({ limit: 200 }), { wrapper: wrap });
    await waitFor(() => expect(b.result.current.isSuccess).toBe(true));
    expect(api.mock.calls.at(-1)?.[0]).toBe('/api/users?limit=200');
  });
});

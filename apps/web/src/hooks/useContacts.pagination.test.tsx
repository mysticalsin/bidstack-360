import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { api } from '@/lib/api';
import { useContacts } from './useContacts';

// Regression: the Contacts list was silently capped at the backend default (50)
// because the hook sent no cursor/limit and dropped nextCursor. These assert the
// hook now drives the cursor-paginated contract the backend already exposes.
vi.mock('@/lib/api', () => ({
  api: vi.fn(async () => ({ items: [], nextCursor: 'next-page-token' })),
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useContacts pagination', () => {
  beforeEach(() => vi.mocked(api).mockClear());

  it('sends limit and cursor in the request URL', async () => {
    renderHook(() => useContacts({ search: 'acme', limit: 50, cursor: 'cur-123' }), { wrapper });
    await waitFor(() => expect(api).toHaveBeenCalled());
    const calledPath = vi.mocked(api).mock.calls[0]![0] as string;
    expect(calledPath).toContain('limit=50');
    expect(calledPath).toContain('cursor=cur-123');
    expect(calledPath).toContain('search=acme');
  });

  it('surfaces nextCursor from the response so the pager can advance', async () => {
    const { result } = renderHook(() => useContacts({ limit: 50 }), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.nextCursor).toBe('next-page-token');
  });

  it('omits cursor/limit when not provided (no spurious params)', async () => {
    renderHook(() => useContacts(), { wrapper });
    await waitFor(() => expect(api).toHaveBeenCalled());
    const calledPath = vi.mocked(api).mock.calls[0]![0] as string;
    expect(calledPath).not.toContain('cursor=');
    expect(calledPath).not.toContain('limit=');
  });
});

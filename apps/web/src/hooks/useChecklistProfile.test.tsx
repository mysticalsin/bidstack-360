import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/lib/api';
import { useChecklistProfileNamed } from './usePoloIdentity';

vi.mock('@/lib/api', () => ({ api: vi.fn(async () => ({})) }));

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: 3, retryDelay: 0 }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function me(name: string | null) {
  return {
    id: 'user-1',
    email: 'visitor@example.com',
    name,
    role: 'admin',
    roles: ['admin'],
    dataMode: 'demo' as const,
    authProvider: 'demo' as const,
  };
}

describe('useChecklistProfileNamed', () => {
  beforeEach(() => {
    vi.mocked(api).mockReset();
  });

  it('reads the display name demo sign-in stores on the user', async () => {
    vi.mocked(api).mockResolvedValue(me('Demo User'));
    const { result } = renderHook(() => useChecklistProfileNamed(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(true);
    expect(api).toHaveBeenCalledWith(
      '/api/me',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('treats a blank or whitespace name as no profile', async () => {
    vi.mocked(api).mockResolvedValue(me('   '));
    const { result } = renderHook(() => useChecklistProfileNamed(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(false);
  });

  it('does not retry a denied read, so a missing name is not invented', async () => {
    vi.mocked(api).mockRejectedValue(Object.assign(new Error('denied'), { status: 403 }));
    const { result } = renderHook(() => useChecklistProfileNamed(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(api).toHaveBeenCalledTimes(1);
  });
});

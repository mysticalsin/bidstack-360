import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { api } from '@/lib/api';
import { useChecklistActivityCount } from './useActivityFeed';

vi.mock('@/lib/api', () => ({ api: vi.fn(async () => ({ items: [], total: 0 })) }));

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useChecklistActivityCount', () => {
  beforeEach(() => vi.mocked(api).mockClear());

  it('reads the activity total the checklist uses, not the timeline bodies', async () => {
    // WHY: Quick Start must follow the same activity list the timeline reads,
    // without downloading call and email bodies. One row is enough; `total` is
    // the signal. A lead on the org summary is not this number.
    vi.mocked(api).mockResolvedValue({
      items: [{ id: 'a1', type: 'call', body: 'do not keep this' }],
      total: 20,
    });
    const { result } = renderHook(() => useChecklistActivityCount(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api).toHaveBeenCalledWith(
      '/api/v1/activities?limit=1',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(result.current.data).toBe(20);
  });
});

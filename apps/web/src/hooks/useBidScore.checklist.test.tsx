import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { api } from '@/lib/api';
import { useChecklistBidScoreCount, useCreateBidScore } from './useBidScore';

vi.mock('@/lib/api', () => ({ api: vi.fn(async () => ({ items: [] })) }));

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useChecklistBidScoreCount', () => {
  beforeEach(() => vi.mocked(api).mockClear());

  it('reads whether a bid score exists, not the matrix notes', async () => {
    // WHY: Quick Start must follow the same bid/no-bid list the matrix reads,
    // without keeping criteria or notes. One row is enough. A deal on the org
    // summary is not this number.
    vi.mocked(api).mockResolvedValue({
      items: [{ id: 'score-1', notes: 'do not keep this', criteria: { strategic_fit: 4 } }],
    });
    const { result } = renderHook(() => useChecklistBidScoreCount(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api).toHaveBeenCalledWith(
      '/api/v1/bid-scores?limit=1',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(result.current.data).toBe(1);
  });

  it('refreshes the checklist count after a score is saved', async () => {
    // WHY: once the list has settled at zero, a click no longer closes the row.
    // Saving a score has to refresh that count, or the step stays open after
    // the visitor did the work.
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    vi.mocked(api).mockResolvedValue({ id: 'score-1' });
    const { result } = renderHook(() => useCreateBidScore(), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    });
    result.current.mutate({ opportunityId: 'opp-2048', criteria: { strategic_fit: 4 } });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['bid-score', 'checklist-count'] });
  });
});

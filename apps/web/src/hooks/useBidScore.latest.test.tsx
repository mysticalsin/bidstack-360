// Why this test exists: an opportunity with no bid score is a normal empty
// state. The latest-score request must not leave the card in an error state.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', () => {
  class ApiError extends Error {
    readonly status: number;
    readonly body: unknown;
    constructor(message: string, status: number, body: unknown) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.body = body;
    }
  }
  return { api: vi.fn(), ApiError };
});

import { ApiError, api } from '@/lib/api';
import { useBidScoreLatest } from './useBidScore';

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useBidScoreLatest', () => {
  beforeEach(() => {
    vi.mocked(api).mockReset();
  });

  it('treats a missing score as empty data, not an error', async () => {
    vi.mocked(api).mockRejectedValue(new ApiError('No bid score found for this opportunity', 404, null));
    const { result } = renderHook(() => useBidScoreLatest('opp-1'), { wrapper });
    await waitFor(() => expect(result.current.isFetched).toBe(true));
    expect(result.current.isError).toBe(false);
    expect(result.current.data).toBeNull();
  });
});

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: apiMock }));

import { AUTOPOPULATE_MAX, useAutopopulateSalesCompanies } from './useAutopopulateSalesCompanies';

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useAutopopulateSalesCompanies', () => {
  it('never asks the API for more accounts than it accepts', async () => {
    apiMock.mockResolvedValue({ enriched: 0, cached: 0, items: [] });
    const { result } = renderHook(() => useAutopopulateSalesCompanies(), { wrapper });

    result.current.mutate({ limit: 20 });

    await waitFor(() => expect(apiMock).toHaveBeenCalled());
    const body = apiMock.mock.calls[0]?.[1]?.body as { limit: number };
    expect(AUTOPOPULATE_MAX).toBe(12);
    expect(body.limit).toBe(12);
  });
});

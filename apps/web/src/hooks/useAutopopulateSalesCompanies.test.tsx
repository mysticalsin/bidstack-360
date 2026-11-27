import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, api: apiMock };
});

import { ApiError } from '@/lib/api';
import { AUTOPOPULATE_MAX, useAutopopulateSalesCompanies } from './useAutopopulateSalesCompanies';

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useAutopopulateSalesCompanies', () => {
  it('does not pull accounts when ERP is unset the way demo runs', async () => {
    // WHY: demo leaves ERP unconfigured. A click must not POST the local
    // opportunity book and then read as an ERP sale.order sync.
    apiMock.mockImplementation((path: string) => {
      if (String(path).includes('/erp/status')) {
        return Promise.resolve({
          configured: false,
          url: null,
          database: null,
          reachable: false,
          toolCount: null,
          lastError: null,
        });
      }
      return Promise.resolve({ enriched: 4, cached: 2, items: [] });
    });
    const { result } = renderHook(() => useAutopopulateSalesCompanies(), { wrapper });

    await waitFor(() => expect(result.current.erpSync).toBe('unset'));
    result.current.mutate({ limit: 12 });

    const paths = apiMock.mock.calls.map(([path]) => String(path));
    expect(paths.some((path) => path.includes('autopopulate-from-sales'))).toBe(false);
    expect(result.current.data).toBeUndefined();
  });

  it('treats a missing ERP status route as unset', async () => {
    // WHY: a deployment with no ERP routes must not fall through to a local pull.
    apiMock.mockImplementation((path: string) => {
      if (String(path).includes('/erp/status')) {
        return Promise.reject(new ApiError('Not Found', 404, null));
      }
      return Promise.resolve({ enriched: 1, cached: 0, items: [] });
    });
    const { result } = renderHook(() => useAutopopulateSalesCompanies(), { wrapper });

    await waitFor(() => expect(result.current.erpSync).toBe('unset'));
    result.current.mutate({ limit: 12 });

    const paths = apiMock.mock.calls.map(([path]) => String(path));
    expect(paths.some((path) => path.includes('autopopulate-from-sales'))).toBe(false);
  });

  it('never asks the API for more accounts than it accepts', async () => {
    apiMock.mockImplementation((path: string) => {
      if (String(path).includes('/erp/status')) {
        return Promise.resolve({
          configured: true,
          url: 'http://erp.test/mcp',
          database: 'demo',
          reachable: true,
          toolCount: 1,
          lastError: null,
        });
      }
      return Promise.resolve({ enriched: 0, cached: 0, items: [] });
    });
    const { result } = renderHook(() => useAutopopulateSalesCompanies(), { wrapper });

    await waitFor(() => expect(result.current.erpSync).toBe('ready'));
    result.current.mutate({ limit: 20 });

    await waitFor(() =>
      expect(apiMock.mock.calls.some(([path]) => String(path).includes('autopopulate-from-sales'))).toBe(
        true,
      ),
    );
    const call = apiMock.mock.calls.find(([path]) => String(path).includes('autopopulate-from-sales'));
    const body = call?.[1]?.body as { limit: number };
    expect(AUTOPOPULATE_MAX).toBe(12);
    expect(body.limit).toBe(12);
  });
});

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { api } from '@/lib/api';
import { useCreateProduct, useCreateProductCategory, useUpdateProduct } from './useProducts';

vi.mock('@/lib/api', () => ({
  api: vi.fn(async () => ({
    id: '11111111-1111-4111-8111-111111111111',
    sku: 'BID-001',
    name: 'BidStack Product',
    categoryId: null,
    categoryName: null,
    listPriceMicros: '1000000',
    currency: 'CAD',
    active: true,
    createdAt: '2026-05-17T00:00:00.000Z',
    updatedAt: '2026-05-17T00:00:00.000Z',
  })),
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useProducts mutations', () => {
  it('sends product create bodies as objects so the API client encodes JSON exactly once', async () => {
    const { result } = renderHook(() => useCreateProduct(), { wrapper });
    const body = {
      sku: 'bid-001',
      name: 'BidStack Product',
      listPriceMicros: 1_000_000,
      currency: 'cad',
      active: true,
    };

    await act(async () => {
      await result.current.mutateAsync(body);
    });

    expect(api).toHaveBeenCalledWith('/api/products', {
      method: 'POST',
      body,
    });
  });

  it('sends category create bodies as objects', async () => {
    const { result } = renderHook(() => useCreateProductCategory(), { wrapper });
    const body = { name: 'Professional Services' };

    await act(async () => {
      await result.current.mutateAsync(body);
    });

    expect(api).toHaveBeenCalledWith('/api/products/categories', {
      method: 'POST',
      body,
    });
  });

  it('sends product update bodies as objects', async () => {
    const { result } = renderHook(
      () => useUpdateProduct('22222222-2222-4222-8222-222222222222'),
      { wrapper },
    );
    const body = { active: false };

    await act(async () => {
      await result.current.mutateAsync(body);
    });

    expect(api).toHaveBeenCalledWith('/api/products/22222222-2222-4222-8222-222222222222', {
      method: 'PATCH',
      body,
    });
  });
});

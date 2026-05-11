// Hooks for the Sales Dashboard widgets — one per endpoint, so individual
// cards refetch / suspend independently and slow widgets don't gate the rest.
//
// All endpoints land BigInt-encoded as strings in `*.revenueMicros` etc.;
// formatters at the call site convert back via BigInt(s).

import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';

import type {
  SalesDashMonthly,
  SalesKpi,
  SalesPeriod,
  TopCategories,
  TopCountries,
  TopList,
  TopProducts,
} from '@bidstack/shared';

export function useSalesKpi(period: SalesPeriod = 'last_90d') {
  return useQuery({
    queryKey: ['sales:kpis', period],
    queryFn: ({ signal }) =>
      api<SalesKpi>(`/api/sales-dashboard/kpis?period=${period}`, { signal }),
    staleTime: 60_000,
  });
}

export function useMonthlySales() {
  return useQuery({
    queryKey: ['sales:monthly'],
    queryFn: ({ signal }) =>
      api<SalesDashMonthly>('/api/sales-dashboard/monthly-sales', { signal }),
    staleTime: 60_000,
  });
}

export function useTopQuotations(limit = 10) {
  return useQuery({
    queryKey: ['sales:top-quotations', limit],
    queryFn: ({ signal }) =>
      api<TopList>(`/api/sales-dashboard/top-quotations?limit=${limit}`, { signal }),
    staleTime: 60_000,
  });
}

export function useTopOrders(limit = 10) {
  return useQuery({
    queryKey: ['sales:top-orders', limit],
    queryFn: ({ signal }) =>
      api<TopList>(`/api/sales-dashboard/top-orders?limit=${limit}`, { signal }),
    staleTime: 60_000,
  });
}

export function useTopCountries(limit = 10) {
  return useQuery({
    queryKey: ['sales:top-countries', limit],
    queryFn: ({ signal }) =>
      api<TopCountries>(`/api/sales-dashboard/top-countries?limit=${limit}`, { signal }),
    staleTime: 60_000,
  });
}

export function useTopProducts(limit = 10) {
  return useQuery({
    queryKey: ['sales:top-products', limit],
    queryFn: ({ signal }) =>
      api<TopProducts>(`/api/sales-dashboard/top-products?limit=${limit}`, { signal }),
    staleTime: 60_000,
  });
}

export function useTopCustomers(limit = 10) {
  return useQuery({
    queryKey: ['sales:top-customers', limit],
    queryFn: ({ signal }) =>
      api<TopList>(`/api/sales-dashboard/top-customers?limit=${limit}`, { signal }),
    staleTime: 60_000,
  });
}

export function useTopCategories(limit = 10) {
  return useQuery({
    queryKey: ['sales:top-categories', limit],
    queryFn: ({ signal }) =>
      api<TopCategories>(`/api/sales-dashboard/top-categories?limit=${limit}`, { signal }),
    staleTime: 60_000,
  });
}

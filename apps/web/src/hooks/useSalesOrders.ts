// Hooks for /api/sales/orders. List with cursor pagination + filters,
// detail with optimistic state transitions, and a create-quotation mutation.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';

import type {
  OrderState,
  SalesOrderCreate,
  SalesOrderDetail,
  SalesOrderPage,
} from '@bidstack/shared';

export interface SalesOrdersListFilter {
  state?: OrderState;
  salespersonId?: string;
  countryCode?: string;
  search?: string;
  cursor?: string;
  limit?: number;
}

function queryString(filter: SalesOrdersListFilter): string {
  const params = new URLSearchParams();
  if (filter.state) params.set('state', filter.state);
  if (filter.salespersonId) params.set('salespersonId', filter.salespersonId);
  if (filter.countryCode) params.set('countryCode', filter.countryCode);
  if (filter.search) params.set('search', filter.search);
  if (filter.cursor) params.set('cursor', filter.cursor);
  if (filter.limit) params.set('limit', String(filter.limit));
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export function useSalesOrders(filter: SalesOrdersListFilter = {}) {
  return useQuery({
    queryKey: ['sales:orders', filter],
    queryFn: ({ signal }) =>
      api<SalesOrderPage>(`/api/sales/orders${queryString(filter)}`, { signal }),
    staleTime: 30_000,
  });
}

export function useSalesOrder(id: string | undefined) {
  return useQuery({
    queryKey: ['sales:order', id],
    queryFn: ({ signal }) => api<SalesOrderDetail>(`/api/sales/orders/${id}`, { signal }),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}

export function useCreateSalesOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SalesOrderCreate) =>
      api<SalesOrderDetail>('/api/sales/orders', { method: 'POST', body }),
    onSuccess: (created) => {
      // Seed the detail cache so navigation to /sales/orders/:id doesn't refetch.
      qc.setQueryData(['sales:order', created.id], created);
      void qc.invalidateQueries({ queryKey: ['sales:orders'] });
      void qc.invalidateQueries({ queryKey: ['sales:kpis'] });
      void qc.invalidateQueries({ queryKey: ['sales:monthly'] });
    },
  });
}

export type TransitionAction = 'send' | 'confirm' | 'done' | 'cancel' | 'reopen';

export function useTransitionSalesOrder(action: TransitionAction) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      api<SalesOrderDetail>(`/api/sales/orders/${id}/${action}`, {
        method: 'POST',
        body: reason ? { reason } : {},
      }),
    onSuccess: (updated) => {
      qc.setQueryData(['sales:order', updated.id], updated);
      void qc.invalidateQueries({ queryKey: ['sales:orders'] });
      void qc.invalidateQueries({ queryKey: ['sales:kpis'] });
      void qc.invalidateQueries({ queryKey: ['sales:monthly'] });
      void qc.invalidateQueries({ queryKey: ['sales:top-quotations'] });
      void qc.invalidateQueries({ queryKey: ['sales:top-orders'] });
    },
  });
}

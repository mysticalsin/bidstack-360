// Hooks for /api/invoices. List with cursor pagination + filters,
// detail with optimistic state transitions, and payment recording.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';

import type {
  InvoiceCreate,
  InvoiceDetail,
  InvoiceFilter,
  InvoicePage,
  PaymentCreate,
} from '@bidstack/shared';

export type InvoicesListFilter = Omit<InvoiceFilter, 'cursor' | 'limit'> & {
  cursor?: string;
  limit?: number;
};

function queryString(filter: InvoicesListFilter): string {
  const params = new URLSearchParams();
  if (filter.state) params.set('state', filter.state);
  if (filter.customerName) params.set('customerName', filter.customerName);
  if (filter.salesOrderId) params.set('salesOrderId', filter.salesOrderId);
  if (filter.countryCode) params.set('countryCode', filter.countryCode);
  if (filter.search) params.set('search', filter.search);
  if (filter.overdueOnly) params.set('overdueOnly', 'true');
  if (filter.cursor) params.set('cursor', filter.cursor);
  if (filter.limit) params.set('limit', String(filter.limit));
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export function useInvoices(filter: InvoicesListFilter = {}) {
  return useQuery({
    queryKey: ['invoices', filter],
    queryFn: ({ signal }) => api<InvoicePage>(`/api/invoices${queryString(filter)}`, { signal }),
    staleTime: 30_000,
  });
}

export function useInvoice(id: string | undefined) {
  return useQuery({
    queryKey: ['invoice', id],
    queryFn: ({ signal }) => api<InvoiceDetail>(`/api/invoices/${id}`, { signal }),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}

export function useCreateInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: InvoiceCreate) =>
      api<InvoiceDetail>('/api/invoices', { method: 'POST', body }),
    onSuccess: (created) => {
      qc.setQueryData(['invoice', created.id], created);
      void qc.invalidateQueries({ queryKey: ['invoices'] });
    },
  });
}

export type InvoiceTransitionAction = 'send' | 'pay' | 'cancel' | 'reopen';

export function useTransitionInvoice(action: InvoiceTransitionAction) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      api<InvoiceDetail>(`/api/invoices/${id}/${action}`, {
        method: 'POST',
        body: reason ? { reason } : {},
      }),
    onSuccess: (updated) => {
      qc.setQueryData(['invoice', updated.id], updated);
      void qc.invalidateQueries({ queryKey: ['invoices'] });
    },
  });
}

export function useUpdateInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<InvoiceCreate> }) =>
      api<InvoiceDetail>(`/api/invoices/${id}`, { method: 'PATCH', body }),
    onSuccess: (updated) => {
      qc.setQueryData(['invoice', updated.id], updated);
      void qc.invalidateQueries({ queryKey: ['invoices'] });
    },
  });
}

export function useCreateInvoiceFromOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      orderId,
      netDays,
      notes,
    }: {
      orderId: string;
      netDays?: number;
      notes?: string;
    }) =>
      api<InvoiceDetail>(`/api/invoices/from-order/${orderId}`, {
        method: 'POST',
        body: { netDays: netDays ?? 30, notes: notes ?? null },
      }),
    onSuccess: (created) => {
      qc.setQueryData(['invoice', created.id], created);
      void qc.invalidateQueries({ queryKey: ['invoices'] });
    },
  });
}

export function useRecordPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payment }: { id: string; payment: PaymentCreate }) =>
      api<InvoiceDetail>(`/api/invoices/${id}/payments`, {
        method: 'POST',
        body: payment,
      }),
    onSuccess: (updated) => {
      qc.setQueryData(['invoice', updated.id], updated);
      void qc.invalidateQueries({ queryKey: ['invoices'] });
    },
  });
}

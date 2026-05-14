// Hook for /api/invoices/ar-aging — accounts-receivable aging buckets.

import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';

import type { ArAgingReport } from '@bidstack/shared';

export function useArAging(currency?: string) {
  return useQuery({
    queryKey: ['invoices', 'ar-aging', currency],
    queryFn: ({ signal }) =>
      api<ArAgingReport>(`/api/invoices/ar-aging${currency ? `?currency=${currency}` : ''}`, {
        signal,
      }),
    staleTime: 60_000,
  });
}

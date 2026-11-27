import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { CompanyAutopopulateResponse } from '@bidstack/shared';

import { ApiError, api } from '@/lib/api';

/** Server bound on `limit` for POST /crm/companies/autopopulate-from-sales. */
export const AUTOPOPULATE_MAX = 12;

/** Whether a sale.order pull is allowed. Demo leaves this unset. */
export type ErpSyncGate = 'pending' | 'unset' | 'unknown' | 'ready';

interface ErpStatusProbe {
  configured: boolean;
}

export function useAutopopulateSalesCompanies() {
  const queryClient = useQueryClient();
  const erp = useQuery({
    queryKey: ['erp:status'],
    queryFn: ({ signal }) => api<ErpStatusProbe>('/api/integrations/erp/status', { signal }),
    retry: (count, err) => !(err instanceof ApiError && err.status === 404) && count < 2,
  });
  const mutation = useMutation({
    mutationFn: (input: { limit?: number } = {}) =>
      api<CompanyAutopopulateResponse>('/api/crm/companies/autopopulate-from-sales', {
        method: 'POST',
        body: { limit: Math.min(input.limit ?? 8, AUTOPOPULATE_MAX), source: 'all' },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['report:sales-intelligence'] });
      void queryClient.invalidateQueries({ queryKey: ['crm-dashboard'] });
    },
  });

  const erpSync: ErpSyncGate = erp.isPending
    ? 'pending'
    : erp.isError
      ? erp.error instanceof ApiError && erp.error.status === 404
        ? 'unset'
        : 'unknown'
      : erp.data?.configured === true
        ? 'ready'
        : 'unset';

  return {
    ...mutation,
    erpSync,
    mutate: (input: { limit?: number } = {}, options?: Parameters<typeof mutation.mutate>[1]) => {
      // An unset or still-unknown ERP is not a sale.order pull. Demo synthetic
      // accounts stay where they are.
      if (erpSync !== 'ready') return;
      mutation.mutate(input, options);
    },
  };
}

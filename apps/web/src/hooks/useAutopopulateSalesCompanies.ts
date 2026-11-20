import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { CompanyAutopopulateResponse } from '@bidstack/shared';

import { api } from '@/lib/api';

/** Server bound on `limit` for POST /crm/companies/autopopulate-from-sales. */
export const AUTOPOPULATE_MAX = 12;

export function useAutopopulateSalesCompanies() {
  const queryClient = useQueryClient();
  return useMutation({
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
}

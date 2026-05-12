import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { CompanyAutopopulateResponse } from '@bidstack/shared';

import { api } from '@/lib/api';

export function useAutopopulateSalesCompanies() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { limit?: number } = {}) =>
      api<CompanyAutopopulateResponse>('/api/crm/companies/autopopulate-from-sales', {
        method: 'POST',
        body: { limit: input.limit ?? 8, source: 'all' },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['report:sales-intelligence'] });
      void queryClient.invalidateQueries({ queryKey: ['crm-dashboard'] });
    },
  });
}

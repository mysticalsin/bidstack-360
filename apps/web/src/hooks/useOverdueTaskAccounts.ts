import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';

export interface OverdueTaskAccounts {
  accounts: number;
  complete: boolean;
}

/** Accounts in the current view that already have an overdue open task. */
export function useOverdueTaskAccounts(companyIds: readonly string[]) {
  return useQuery({
    queryKey: ['crm-overdue-task-accounts', companyIds],
    enabled: companyIds.length > 0,
    staleTime: 30_000,
    queryFn: ({ signal }) =>
      api<OverdueTaskAccounts>('/api/crm/accounts/overdue-task-accounts', {
        method: 'POST',
        signal,
        body: { companyIds: [...companyIds] },
      }),
  });
}

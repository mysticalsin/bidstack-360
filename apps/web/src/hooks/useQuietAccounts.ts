import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';

export interface QuietAccounts {
  accounts: number;
  complete: boolean;
}

/** Accounts in the current view that have gone quiet. */
export function useQuietAccounts(companyIds: readonly string[]) {
  return useQuery({
    queryKey: ['crm-quiet-accounts', companyIds],
    enabled: companyIds.length > 0,
    staleTime: 30_000,
    queryFn: ({ signal }) =>
      api<QuietAccounts>('/api/crm/accounts/quiet-accounts', {
        method: 'POST',
        signal,
        body: { companyIds: [...companyIds] },
      }),
  });
}

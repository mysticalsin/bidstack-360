import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';

export interface ChampionCoverage {
  accounts: number;
  missing: number;
}

/** Accepted-champion gap for the accounts in the current view. */
export function useChampionCoverage(companyIds: readonly string[]) {
  return useQuery({
    queryKey: ['crm-champion-coverage', companyIds],
    enabled: companyIds.length > 0,
    staleTime: 30_000,
    queryFn: ({ signal }) =>
      api<ChampionCoverage>('/api/crm/accounts/champion-coverage', {
        method: 'POST',
        signal,
        body: { companyIds: [...companyIds] },
      }),
  });
}

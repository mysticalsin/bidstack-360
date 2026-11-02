import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';

export interface AccountOpenBookStage {
  stage: string;
  stageName: string | null;
  count: number;
  valueSumMicros: string;
}

export interface AccountOpenBook {
  stages: AccountOpenBookStage[];
}

/** Full open book for the accounts in the current view. Not the dashboard deal page. */
export function useAccountOpenBook(companyIds: readonly string[]) {
  return useQuery({
    queryKey: ['crm-account-open-book', companyIds],
    enabled: companyIds.length > 0,
    staleTime: 30_000,
    queryFn: ({ signal }) =>
      api<AccountOpenBook>('/api/crm/accounts/open-book', {
        method: 'POST',
        signal,
        body: { companyIds: [...companyIds] },
      }),
  });
}

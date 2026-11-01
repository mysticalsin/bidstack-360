import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AccountFinancials } from '@bidstack/shared';

import { api } from '@/lib/api';

export type { AccountFinancials };

/** v23: filed statements and early-warning signals for one account. */
export function useAccountFinancials(companyId: string | undefined) {
  return useQuery({
    queryKey: ['account-financials', companyId],
    enabled: Boolean(companyId),
    queryFn: ({ signal }) => api<AccountFinancials>(`/api/accounts/${encodeURIComponent(companyId!)}/financials`, { signal }),
    staleTime: 10 * 60_000,
  });
}

/** Admin / AE: opt a General account in or out of the financials pull. */
export function useTrackFinancials(companyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (trackFinancials: boolean) =>
      api<AccountFinancials>(`/api/accounts/${encodeURIComponent(companyId)}/financials/track`, { method: 'PATCH', body: { trackFinancials } }),
    onSuccess: (data) => qc.setQueryData(['account-financials', companyId], data),
  });
}

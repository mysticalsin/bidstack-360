// v24: what to position (plays, brief, gaps) and the key-numbers strip.
import { useQuery } from '@tanstack/react-query';

import type { AccountKeyNumbers, AccountPositioning } from '@bidstack/shared';

import { api } from '@/lib/api';

const enc = encodeURIComponent;

export function useAccountPositioning(companyId: string | undefined) {
  return useQuery({
    queryKey: ['account-positioning', companyId],
    enabled: Boolean(companyId),
    queryFn: ({ signal }) => api<AccountPositioning>(`/api/accounts/${enc(companyId!)}/positioning`, { signal }),
    staleTime: 10 * 60_000,
  });
}

export function useAccountKeyNumbers(companyId: string | undefined) {
  return useQuery({
    queryKey: ['account-key-numbers', companyId],
    enabled: Boolean(companyId),
    queryFn: ({ signal }) => api<AccountKeyNumbers>(`/api/accounts/${enc(companyId!)}/key-numbers`, { signal }),
    staleTime: 10 * 60_000,
  });
}

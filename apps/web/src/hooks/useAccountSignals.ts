// v21 account signals: pulse (momentum), merged timeline, inferred initiatives
// and the portfolio momentum view. Contract: /workspace/fleet/polo-signals-api.md.
import { useQuery } from '@tanstack/react-query';

import type { AccountInitiatives, AccountPulse, AccountTimeline, PortfolioMomentum } from '@bidstack/shared';

import { api } from '@/lib/api';

const enc = encodeURIComponent;

export function useAccountPulse(companyId: string | undefined) {
  return useQuery({
    queryKey: ['account-pulse', companyId],
    enabled: Boolean(companyId),
    queryFn: ({ signal }) => api<AccountPulse>(`/api/accounts/${enc(companyId!)}/pulse`, { signal }),
    staleTime: 5 * 60_000,
  });
}

export function useAccountTimeline(companyId: string | undefined, days = 365) {
  return useQuery({
    queryKey: ['account-timeline', companyId, days],
    enabled: Boolean(companyId),
    queryFn: ({ signal }) => api<AccountTimeline>(`/api/accounts/${enc(companyId!)}/timeline?days=${days}`, { signal }),
    staleTime: 5 * 60_000,
  });
}

export function useAccountInitiatives(companyId: string | undefined) {
  return useQuery({
    queryKey: ['account-initiatives', companyId],
    enabled: Boolean(companyId),
    queryFn: ({ signal }) => api<AccountInitiatives>(`/api/accounts/${enc(companyId!)}/initiatives`, { signal }),
    staleTime: 10 * 60_000,
  });
}

export function usePortfolioMomentum(limit = 40) {
  return useQuery({
    queryKey: ['portfolio-momentum', limit],
    queryFn: ({ signal }) => api<PortfolioMomentum>(`/api/portfolio/momentum?limit=${limit}`, { signal }),
    staleTime: 5 * 60_000,
  });
}

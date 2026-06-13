import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface TopAccount {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  logoUrl: string | null;
  tier: string;
  topAccountRank: number | null;
  totalValue: number;
  wonValue: number;
  openDeals: number;
  contactCount: number;
  opportunityCount: number;
}

// 'curated' = admin-managed global top-10 (Company.topAccountRank);
// 'auto' = fallback leaderboard ranked by total pipeline value.
export type TopAccountsSource = 'curated' | 'auto';

export interface TopAccountsResponse {
  items: TopAccount[];
  source: TopAccountsSource;
}

export function useTopAccounts(filters?: { search?: string; industry?: string; limit?: number }) {
  return useQuery<TopAccountsResponse>({
    queryKey: ['top-accounts', filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters?.search) params.set('search', filters.search);
      if (filters?.industry) params.set('industry', filters.industry);
      if (filters?.limit) params.set('limit', String(filters.limit));
      return api(`/api/accounts/top?${params.toString()}`);
    },
  });
}

/** Replaces the curated top-10 (admin only). An empty array reverts to auto. */
export function useUpdateTopAccountList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (companyIds: string[]) =>
      api<{ companyIds: string[] }>('/api/accounts/top-list', {
        method: 'PUT',
        body: { companyIds },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['top-accounts'] }),
  });
}

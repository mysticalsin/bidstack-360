import { useQuery } from '@tanstack/react-query';
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

export function useTopAccounts(filters?: { search?: string; industry?: string; limit?: number }) {
  return useQuery<{ items: TopAccount[] }>({
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

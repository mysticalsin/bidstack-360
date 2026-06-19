import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface KeyAccount {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  logoUrl: string | null;
  tier: string;
  keyAccountSince: string | null;
  keyAccountOwnerId: string | null;
  keyAccountNotes: string | null;
  totalValue: number;
  openDeals: number;
  contactCount: number;
  opportunityCount: number;
}

interface KeyAccountFilters {
  search?: string;
  industry?: string;
  ownerId?: string;
  limit?: number;
  cursor?: string;
}

export interface KeyAccountsResponse {
  items: KeyAccount[];
  nextCursor: string | null;
}

export function useKeyAccounts(filters?: KeyAccountFilters) {
  return useQuery<KeyAccountsResponse>({
    queryKey: ['key-accounts', filters],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams();
      if (filters?.search) params.set('search', filters.search);
      if (filters?.industry) params.set('industry', filters.industry);
      if (filters?.ownerId) params.set('ownerId', filters.ownerId);
      if (filters?.limit) params.set('limit', String(filters.limit));
      if (filters?.cursor) params.set('cursor', filters.cursor);
      return api(`/api/accounts/key?${params.toString()}`, { signal });
    },
  });
}

export function useAccountIndustries() {
  return useQuery<{ items: string[] }>({
    queryKey: ['account-industries'],
    queryFn: async () => api('/api/accounts/industries'),
  });
}

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

export function useKeyAccounts(filters?: { search?: string; industry?: string; ownerId?: string }) {
  return useQuery<{ items: KeyAccount[] }>({
    queryKey: ['key-accounts', filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters?.search) params.set('search', filters.search);
      if (filters?.industry) params.set('industry', filters.industry);
      if (filters?.ownerId) params.set('ownerId', filters.ownerId);
      return api(`/api/accounts/key?${params.toString()}`);
    },
  });
}

export function useAccountIndustries() {
  return useQuery<{ items: string[] }>({
    queryKey: ['account-industries'],
    queryFn: async () => api('/api/accounts/industries'),
  });
}

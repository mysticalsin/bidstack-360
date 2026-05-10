import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';

import type {
  Opportunity,
  OpportunityFilter,
  OpportunityPage,
} from '@bidstack/shared';

export function useOpportunities(filter: Partial<OpportunityFilter> = {}) {
  return useQuery({
    queryKey: ['opportunities', filter],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(filter)) {
        if (v !== undefined && v !== null && v !== '') {
          params.set(k, String(v));
        }
      }
      return api<OpportunityPage>(`/api/opportunities?${params.toString()}`, { signal });
    },
  });
}

export function useOpportunity(id: string | undefined) {
  return useQuery({
    enabled: !!id,
    queryKey: ['opportunity', id],
    queryFn: ({ signal }) =>
      api<Opportunity & { intel: Record<string, unknown> }>(
        `/api/opportunities/${id}`,
        { signal },
      ),
  });
}

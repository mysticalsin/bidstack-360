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

// Full 360° payload — see apps/api/src/serializers/opportunity.ts
export interface OpportunityFull extends Opportunity {
  intel: Record<string, unknown>;
  tasks: Array<{ id: string; title: string; status: string; dueDate: string | null }>;
  documents: Array<{
    id: string;
    name: string;
    kind: string;
    bytes: number | null;
    createdAt: string;
  }>;
}

export function useOpportunity(id: string | undefined) {
  return useQuery({
    enabled: !!id,
    queryKey: ['opportunity', id],
    queryFn: ({ signal }) =>
      api<OpportunityFull>(`/api/opportunities/${id}`, { signal }),
  });
}

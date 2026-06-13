import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { OpportunityFilterRules, OpportunityFilterRulesUpdate } from '@bidstack/shared';

export function useOpportunityFilters() {
  return useQuery({
    queryKey: ['opportunity-filters'],
    queryFn: ({ signal }) =>
      api<OpportunityFilterRules>('/api/org-settings/opportunity-filters', { signal }),
  });
}

export function useUpdateOpportunityFilters() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: OpportunityFilterRulesUpdate) =>
      api<OpportunityFilterRules>('/api/org-settings/opportunity-filters', {
        method: 'PUT',
        body,
      }),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ['opportunity-filters'] }),
  });
}

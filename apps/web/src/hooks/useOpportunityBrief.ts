import { useMutation } from '@tanstack/react-query';

import { api } from '@/lib/api';

// Wire to POST /api/opportunities/:id/brief. The endpoint is server-side
// stubbed today (returns deterministic markdown) and will swap to a real
// Dust agent call when DUST_API_KEY + DUST_AGENT_EXEC_BRIEF are set —
// the response shape stays the same.
export interface BriefResponse {
  brief: string;
  model: string;
  tokens: number;
}

export function useOpportunityBrief(opportunityId: string | undefined) {
  return useMutation({
    mutationFn: () => {
      if (!opportunityId) throw new Error('Opportunity id required');
      return api<BriefResponse>(`/api/opportunities/${opportunityId}/brief`, { method: 'POST' });
    },
  });
}

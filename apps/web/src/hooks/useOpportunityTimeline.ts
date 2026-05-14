import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';

export interface TimelineEvent {
  id: string;
  kind: string;
  text: string;
  actorName: string | null;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export function useOpportunityTimeline(oppId: string | undefined) {
  return useQuery({
    queryKey: ['opportunity-timeline', oppId],
    enabled: !!oppId,
    queryFn: ({ signal }) =>
      api<{ items: TimelineEvent[] }>(`/api/opportunities/${oppId}/timeline`, { signal }),
    staleTime: 30_000,
  });
}

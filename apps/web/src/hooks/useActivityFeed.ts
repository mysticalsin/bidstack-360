import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';

export interface ActivityFeedItem {
  id: string;
  type: string;
  occurredAt: string;
}

/** The org's latest activities (newest first, capped at the API's page size). */
export function useActivityFeed(limit = 100, enabled = true) {
  return useQuery({
    queryKey: ['activity-feed', limit],
    queryFn: ({ signal }) =>
      api<{ items: ActivityFeedItem[]; total: number }>(`/api/v1/activities?limit=${limit}`, { signal }),
    enabled,
    staleTime: 60_000,
  });
}

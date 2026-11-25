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

// Quick Start's "log your first activity" row used to flip on a click. A demo
// workspace already has calls, emails, and notes, so the row follows the same
// list the timeline reads. `limit=1` keeps the body to a single row; only
// `total` is used. Org-summary recent activity is leads, deals, tasks, and
// cases, so it is not this signal. A failed read (no activities:read) stays
// unresolved so the page can fall back to the click instead of inventing a log.
export function useChecklistActivityCount() {
  return useQuery({
    queryKey: ['activity-feed', 'checklist-count'],
    queryFn: ({ signal }) =>
      api<{ total: number }>('/api/v1/activities?limit=1', { signal }),
    select: (page) => page.total,
    staleTime: 30_000,
    retry: false,
  });
}

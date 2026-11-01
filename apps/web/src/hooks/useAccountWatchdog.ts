import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';

export type WatchImplication = 'OPPORTUNITY' | 'RISK' | 'NEUTRAL';

export interface AccountWatchdog {
  companyId: string;
  monitoring: {
    enabled: boolean;
    identifiers: string[];
    lastCheckedAt: string | null;
    lastError: string | null;
  };
  events: Array<{
    id: string;
    source: string;
    kind: string;
    title: string;
    summary: string;
    sourceUrl: string;
    occurredAt: string;
    implication: WatchImplication;
    implicationRationale: string | null;
    severity: number;
    status: string;
    /** v21: 0..100 importance (the feed is ordered by it). */
    importance?: number;
    /** v21: funding, launch, initiative, exec_move, risk, earnings, hiring, ... */
    category?: string;
    /** v21: how many outlets carried the same story after dedupe. */
    mentions?: number;
    /** v21: demo data seeded with no live source. */
    sample?: boolean;
    /** v21: title without the "Sample: " prefix. */
    displayTitle?: string;
  }>;
  earnings: Array<{
    id: string;
    fiscalPeriod: string;
    expectedAt: string;
    confirmed: boolean;
    source: string;
    sourceUrl: string;
  }>;
  pastProjects: Array<{
    id: string;
    name: string;
    outcome: 'won' | 'lost';
    valueMicros: string;
    closedAt: string;
  }>;
  history: Array<{ id: string; at: string; type: 'filing' | 'opportunity'; title: string; detail: string }>;
}

export function useAccountWatchdog(companyId: string | undefined) {
  return useQuery({
    queryKey: ['account-watchdog', companyId],
    enabled: Boolean(companyId),
    queryFn: ({ signal }) =>
      api<AccountWatchdog>(`/api/accounts/${encodeURIComponent(companyId!)}/watchdog`, { signal }),
    staleTime: 5 * 60_000,
  });
}

export type WatchEventStatus = 'NEW' | 'ACKNOWLEDGED' | 'DISMISSED';

/** Dismiss / restore a stored signal (PATCH …/watchdog/events/:id). Optimistic: the row leaves the list at once. */
export function useSetWatchEventStatus(companyId: string) {
  const qc = useQueryClient();
  const key = ['account-watchdog', companyId];
  return useMutation({
    mutationFn: ({ eventId, status }: { eventId: string; status: WatchEventStatus }) =>
      api<{ id: string; status: string }>(
        `/api/accounts/${encodeURIComponent(companyId)}/watchdog/events/${encodeURIComponent(eventId)}`,
        { method: 'PATCH', body: { status } },
      ),
    onMutate: async ({ eventId, status }) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<AccountWatchdog>(key);
      if (prev && status === 'DISMISSED') qc.setQueryData<AccountWatchdog>(key, { ...prev, events: prev.events.filter((e) => e.id !== eventId) });
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
}

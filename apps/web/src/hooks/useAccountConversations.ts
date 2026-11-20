import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import type { AccountConversations } from '@bidstack/shared';

import { api } from '@/lib/api';

export function useAccountConversations(companyId: string | undefined) {
  return useInfiniteQuery<AccountConversations>({
    queryKey: ['account-conversations', companyId],
    queryFn: ({ pageParam }) =>
      api(
        `/api/companies/${companyId}/conversations${
          pageParam ? `?cursor=${encodeURIComponent(String(pageParam))}` : ''
        }`,
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: Boolean(companyId),
    staleTime: 60_000,
  });
}

/** File a synced meeting to another opportunity, or to the account only (null). */
export function useRefileMeeting(companyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { calendarEventId: string; opportunityId: string | null }) =>
      api(`/api/calendar/events/${input.calendarEventId}`, {
        method: 'PATCH',
        body: input.opportunityId ? { opportunityId: input.opportunityId } : { companyId, opportunityId: null },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['account-conversations', companyId] });
      void qc.invalidateQueries({ queryKey: ['company-activity-summary', companyId] });
    },
  });
}

/**
 * useCalendarDeadlines — bid/proposal due dates for the calendar's
 * "Deadlines" lane.
 *
 * WHY a dedicated read-only aggregate instead of filtering the opportunity
 * list client-side: /api/opportunities pages at 200 rows and only filters
 * by dueWithinDays-from-now, so past/future weeks (and large orgs) would
 * silently miss deadlines. /api/v1/calendar/deadlines queries the exact
 * date window server-side, org-scoped.
 */
import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';

export type CalendarDeadlineKind = 'opportunity' | 'proposal';

export interface CalendarDeadline {
  kind: CalendarDeadlineKind;
  id: string;
  name: string;
  /** Opportunity customer — null for proposals. */
  customer: string | null;
  /** Opportunity code (OP-NNNN) — null for proposals. */
  code: string | null;
  /** YYYY-MM-DD, date-only: bucket by calendar day, never by local time. */
  dueDate: string;
}

export function useCalendarDeadlines(from: string, to: string) {
  return useQuery<{ items: CalendarDeadline[] }>({
    queryKey: ['calendar-deadlines', from, to],
    queryFn: ({ signal }) =>
      api(
        `/api/v1/calendar/deadlines?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        { signal },
      ),
    staleTime: 60_000,
  });
}

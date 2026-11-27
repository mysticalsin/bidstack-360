import { useMutation, useQueryClient } from '@tanstack/react-query';

import { ApiError, api } from '@/lib/api';

import type { EventMove } from './eventDrag';
import type { CalendarEvent } from './types';

type EventPage = { items: CalendarEvent[] };

/**
 * PATCH a dragged event. A 409 marks that same row CONFLICT so the grid's
 * notice follows the row. When a later payload is no longer CONFLICT, the
 * notice goes with it.
 */
export function useMoveCalendarEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, move }: { id: string; move: EventMove }) =>
      api<CalendarEvent>(`/api/v1/calendar/events/${id}`, { method: 'PATCH', body: move }),
    onSuccess: (event) => {
      qc.setQueriesData<EventPage>({ queryKey: ['calendar-events'] }, (cur) => {
        if (!cur?.items) return cur;
        return { ...cur, items: cur.items.map((row) => (row.id === event.id ? { ...row, ...event } : row)) };
      });
    },
    onError: (err, { id }) => {
      if (!(err instanceof ApiError) || err.status !== 409) return;
      qc.setQueriesData<EventPage>({ queryKey: ['calendar-events'] }, (cur) => {
        if (!cur?.items) return cur;
        return {
          ...cur,
          items: cur.items.map((row) => (row.id === id ? { ...row, syncState: 'CONFLICT' } : row)),
        };
      });
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['calendar-events'] });
    },
  });
}

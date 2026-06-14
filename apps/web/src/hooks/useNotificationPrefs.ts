import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { NotificationPrefs } from '@bidstack/shared';

const KEY = ['notification-prefs'];
const URL = '/api/notifications/prefs';

export function useNotificationPrefs() {
  return useQuery<NotificationPrefs>({
    queryKey: KEY,
    queryFn: ({ signal }) => api<NotificationPrefs>(URL, { signal }),
    staleTime: 60_000,
  });
}

export function useUpdateNotificationPrefs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (prefs: NotificationPrefs) =>
      api<NotificationPrefs>(URL, { method: 'PUT', body: prefs }),
    // Optimistically write the new prefs so the toggles feel instant; reconcile
    // (or roll back) once the server responds.
    onMutate: async (next) => {
      await qc.cancelQueries({ queryKey: KEY });
      const previous = qc.getQueryData<NotificationPrefs>(KEY);
      qc.setQueryData(KEY, next);
      return { previous };
    },
    onError: (_err, _next, ctx) => {
      if (ctx?.previous) qc.setQueryData(KEY, ctx.previous);
    },
    onSuccess: (data) => qc.setQueryData(KEY, data),
  });
}

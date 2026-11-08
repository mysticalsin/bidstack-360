import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  NotificationChannelPrefs,
  NotificationChannelSettings,
  TeamsWebhookTestResult,
} from '@bidstack/shared';

import { api } from '@/lib/api';
import { toast } from '@/components/ui/Toast';

const KEY = ['notification-channels'] as const;

export function useNotificationChannels() {
  return useQuery({
    queryKey: KEY,
    queryFn: ({ signal }) =>
      api<NotificationChannelSettings>('/api/notifications/channels', { signal }),
    staleTime: 60_000,
  });
}

export function useUpdateNotificationChannels() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (prefs: NotificationChannelPrefs) =>
      api<NotificationChannelSettings>('/api/notifications/channels', {
        method: 'PUT',
        body: prefs,
      }),
    onMutate: async (next) => {
      await qc.cancelQueries({ queryKey: KEY });
      const previous = qc.getQueryData<NotificationChannelSettings>(KEY);
      if (previous) qc.setQueryData(KEY, { ...previous, ...next });
      return { previous };
    },
    onError: (err, _next, ctx) => {
      if (ctx?.previous) qc.setQueryData(KEY, ctx.previous);
      toast.error(err instanceof Error ? err.message : 'Could not save delivery settings');
    },
    onSuccess: (data) => qc.setQueryData(KEY, data),
  });
}

export function useSaveTeamsWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (url: string) =>
      api<NotificationChannelSettings>('/api/notifications/teams-webhook', {
        method: 'PUT',
        body: { url },
      }),
    onSuccess: (data) => {
      qc.setQueryData(KEY, data);
      toast.success('Teams webhook saved');
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : 'Could not save the webhook'),
  });
}

export function useClearTeamsWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<NotificationChannelSettings>('/api/notifications/teams-webhook', { method: 'DELETE' }),
    onSuccess: (data) => {
      qc.setQueryData(KEY, data);
      toast.success('Teams webhook removed');
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : 'Could not remove the webhook'),
  });
}

export function useTestTeamsWebhook() {
  return useMutation({
    mutationFn: () =>
      api<TeamsWebhookTestResult>('/api/notifications/teams-webhook/test', { method: 'POST' }),
    onSuccess: (res) => (res.ok ? toast.success(res.message) : toast.warning(res.message)),
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Test send failed'),
  });
}

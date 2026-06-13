import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';

export type NotificationType =
  | 'mention'
  | 'assignment'
  | 'bid_override'
  | 'stage_change'
  | 'system';

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  entityType: string | null;
  entityId: string | null;
  url: string | null;
  readAt: string | null;
  createdAt: string;
}

interface NotificationPage {
  items: AppNotification[];
  unread: number;
}

const NOTIFICATIONS_KEY = ['notifications'] as const;

/** List the user's notifications (newest first) plus the live unread count. */
export function useNotifications(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: NOTIFICATIONS_KEY,
    queryFn: ({ signal }) => api<NotificationPage>('/api/notifications', { signal }),
    enabled: options.enabled ?? true,
    // Light polling keeps the badge fresh even without the realtime channel wired.
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<AppNotification>(`/api/notifications/${id}/read`, { method: 'PATCH' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }),
  });
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<{ updated: number }>('/api/notifications/read-all', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }),
  });
}

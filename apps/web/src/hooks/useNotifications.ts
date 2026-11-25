import { useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

import { api } from '@/lib/api';
import { NotificationSocket, type LiveNotification } from '@/lib/notification-socket';
import { toast } from '@/components/ui/Toast';

export type NotificationType =
  | 'mention'
  | 'assignment'
  | 'bid_override'
  | 'gate_decision'
  | 'stage_change'
  | 'task_due'
  | 'system'
  | 'account_activity';

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

const NOTIFICATION_TYPES: ReadonlySet<string> = new Set([
  'mention',
  'assignment',
  'bid_override',
  'gate_decision',
  'stage_change',
  'task_due',
  'system',
  'account_activity',
]);

function notificationType(type: string): NotificationType {
  return NOTIFICATION_TYPES.has(type) ? (type as NotificationType) : 'system';
}

/**
 * Put a socket alert on the page the bell already holds. A new id counts as
 * unread immediately. The same id is a coalesced update: one row, same count.
 * A row that is already read stays read.
 */
function applyLiveNotification(
  page: NotificationPage | undefined,
  live: LiveNotification,
  now = new Date().toISOString(),
): NotificationPage {
  const current = page ?? { items: [], unread: 0 };
  const index = current.items.findIndex((item) => item.id === live.id);
  const previous = index >= 0 ? current.items[index] : undefined;
  if (previous) {
    const updated: AppNotification = {
      ...previous,
      type: notificationType(live.type),
      title: live.title,
      body: live.body === undefined ? previous.body : live.body,
      url: live.url,
    };
    return {
      unread: current.unread,
      items: [updated, ...current.items.filter((item) => item.id !== live.id)],
    };
  }
  const item: AppNotification = {
    id: live.id,
    type: notificationType(live.type),
    title: live.title,
    body: live.body ?? null,
    entityType: null,
    entityId: null,
    url: live.url,
    readAt: null,
    createdAt: now,
  };
  return { unread: current.unread + 1, items: [item, ...current.items] };
}

/** List the user's notifications (newest first) plus the live unread count. */
export function useNotifications(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: NOTIFICATIONS_KEY,
    queryFn: ({ signal }) => api<NotificationPage>('/api/notifications', { signal }),
    enabled: options.enabled ?? true,
    // Polling stays as the fallback when the realtime socket is down.
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

/**
 * Live alerts: listens on the realtime socket, refreshes the bell and shows a
 * toast with an Open link. Mount once (the topbar bell does). A coalesced
 * alert replaces its earlier toast instead of stacking a second one.
 */
export function useNotificationStream(
  options: { enabled?: boolean; socketFactory?: (url: string) => WebSocket } = {},
) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  useEffect(() => {
    navigateRef.current = navigate;
  }, [navigate]);
  const enabled = options.enabled ?? true;
  const factory = options.socketFactory;

  useEffect(() => {
    if (!enabled) return undefined;
    const shown = new Map<string, string>();
    const onNotification = (n: LiveNotification) => {
      // Drop a list request that started before this alert was written, then
      // show it on the bell before the reload. A reload that fails keeps this
      // page; the tray reads it instead of an empty error.
      void qc.cancelQueries({ queryKey: NOTIFICATIONS_KEY });
      qc.setQueryData<NotificationPage>(NOTIFICATIONS_KEY, (page) => applyLiveNotification(page, n));
      void qc.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
      const previous = shown.get(n.id);
      if (previous) toast.dismiss(previous);
      const url = n.url;
      const toastId = toast.info(n.title, {
        description: n.body ?? undefined,
        duration: 8000,
        action: url ? { label: 'Open', onClick: () => navigateRef.current(url) } : undefined,
      });
      shown.set(n.id, toastId);
    };
    const socket = new NotificationSocket(onNotification, factory);
    void socket.start();
    return () => socket.stop();
  }, [enabled, factory, qc]);
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<AppNotification>(`/api/notifications/${id}/read`, { method: 'PATCH' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }),
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : 'Could not mark notification read'),
  });
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ updated: number }>('/api/notifications/read-all', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }),
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : 'Could not mark all notifications read'),
  });
}

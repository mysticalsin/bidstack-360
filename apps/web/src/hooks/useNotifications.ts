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

function withReadAt(page: NotificationPage | undefined, id: string | 'all'): NotificationPage | undefined {
  if (!page) return page;
  const readAt = new Date().toISOString();
  if (id === 'all') {
    return {
      unread: 0,
      items: page.items.map((item) => (item.readAt === null ? { ...item, readAt } : item)),
    };
  }
  let dropped = false;
  const items = page.items.map((item) => {
    if (item.id !== id || item.readAt !== null) return item;
    dropped = true;
    return { ...item, readAt };
  });
  return { unread: dropped ? Math.max(0, page.unread - 1) : page.unread, items };
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<AppNotification>(`/api/notifications/${id}/read`, { method: 'PATCH' }),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: NOTIFICATIONS_KEY });
      const previous = qc.getQueryData<NotificationPage>(NOTIFICATIONS_KEY);
      qc.setQueryData<NotificationPage>(NOTIFICATIONS_KEY, (page) => withReadAt(page, id));
      return { previous };
    },
    onError: (err, _id, context) => {
      if (context?.previous) qc.setQueryData(NOTIFICATIONS_KEY, context.previous);
      toast.error(err instanceof Error ? err.message : 'Could not mark notification read');
    },
    onSettled: () => qc.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }),
  });
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ updated: number }>('/api/notifications/read-all', { method: 'POST' }),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: NOTIFICATIONS_KEY });
      const previous = qc.getQueryData<NotificationPage>(NOTIFICATIONS_KEY);
      qc.setQueryData<NotificationPage>(NOTIFICATIONS_KEY, (page) => withReadAt(page, 'all'));
      return { previous };
    },
    onError: (err, _vars, context) => {
      if (context?.previous) qc.setQueryData(NOTIFICATIONS_KEY, context.previous);
      toast.error(err instanceof Error ? err.message : 'Could not mark all notifications read');
    },
    onSettled: () => qc.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }),
  });
}

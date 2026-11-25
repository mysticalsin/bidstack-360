// The notification tray shows a fixed window of rows. Today that window is the
// newest rows only, so an older unread alert drops out while the badge still
// counts it.

export const NOTIFICATION_TRAY_LIMIT = 30;

export interface NotificationTrayRow {
  id: string;
  readAt: string | null;
  createdAt: string;
}

export function buildNotificationTray<T extends NotificationTrayRow>(
  recent: readonly T[],
  _unread: readonly T[],
  limit = NOTIFICATION_TRAY_LIMIT,
): T[] {
  return recent.slice(0, limit);
}

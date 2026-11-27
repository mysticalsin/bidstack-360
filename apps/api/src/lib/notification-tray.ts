// The bell counts every unread row. The tray only holds a fixed window, so the
// window is filled with unread rows first. Otherwise an older unread alert
// drops out while the badge still says it is waiting.

export const NOTIFICATION_TRAY_LIMIT = 30;

export interface NotificationTrayRow {
  id: string;
  readAt: string | null;
  createdAt: string;
}

function byNewest<T extends NotificationTrayRow>(a: T, b: T): number {
  if (a.createdAt === b.createdAt) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  return a.createdAt < b.createdAt ? 1 : -1;
}

/**
 * Build the tray page from the newest rows and the newest unread rows.
 * Both lists are already limited to one user. Unread rows come first so the
 * badge and the first row name the same alert. Read rows fill whatever room
 * is left, newest first. A row that appears in both lists is kept once.
 */
export function buildNotificationTray<T extends NotificationTrayRow>(
  recent: readonly T[],
  unread: readonly T[],
  limit = NOTIFICATION_TRAY_LIMIT,
): T[] {
  const seen = new Set<string>();
  const unreadRows: T[] = [];
  const readRows: T[] = [];
  for (const row of [...unread, ...recent]) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    if (row.readAt === null) unreadRows.push(row);
    else readRows.push(row);
  }
  unreadRows.sort(byNewest);
  readRows.sort(byNewest);
  return [...unreadRows, ...readRows].slice(0, limit);
}

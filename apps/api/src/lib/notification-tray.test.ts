import { describe, expect, it } from 'vitest';

import { NOTIFICATION_TRAY_LIMIT, buildNotificationTray } from './notification-tray.js';

// WHY: the bell counts every unread row. The tray only holds 30. When those 30
// are newer and already read, the older unread alert is gone and the badge
// still says it is waiting. Under demo that alert is "Synthetic bid moved to
// proposal" on opp_demo_1 (the 15 May 2026 fixture day).

const UNREAD_ID = '11111111-1111-4111-8111-111111111111';

function readRow(index: number) {
  const day = String(index + 1).padStart(2, '0');
  return {
    id: `22222222-2222-4222-8222-${String(index).padStart(12, '0')}`,
    title: `Synthetic read note ${index}`,
    entityId: null as string | null,
    readAt: '2026-11-20T12:00:00.000Z',
    createdAt: `2026-11-${day}T12:00:00.000Z`,
  };
}

function unreadDemo() {
  return {
    id: UNREAD_ID,
    title: 'Synthetic bid moved to proposal',
    entityId: 'opp_demo_1',
    readAt: null,
    createdAt: '2026-05-15T12:00:00.000Z',
  };
}

describe('buildNotificationTray', () => {
  it('keeps an older unread demo alert when newer read rows fill the window', () => {
    const recent = Array.from({ length: NOTIFICATION_TRAY_LIMIT }, (_, index) => readRow(index));
    const tray = buildNotificationTray(recent, [unreadDemo()]);

    expect(tray).toHaveLength(NOTIFICATION_TRAY_LIMIT);
    expect(tray[0]).toMatchObject({
      id: UNREAD_ID,
      title: 'Synthetic bid moved to proposal',
      entityId: 'opp_demo_1',
      readAt: null,
    });
    expect(tray.filter((row) => row.id === UNREAD_ID)).toHaveLength(1);
    // A read row is what gives up its slot, not the unread alert.
    expect(tray.some((row) => row.readAt !== null)).toBe(true);
    expect(tray[1]?.id).toBe(readRow(NOTIFICATION_TRAY_LIMIT - 1).id);
  });

  it('lists an unread alert once, ahead of a newer read row already on the page', () => {
    const unread = unreadDemo();
    const read = readRow(0);
    const tray = buildNotificationTray([read, unread], [unread]);

    expect(tray.map((row) => row.id)).toEqual([UNREAD_ID, read.id]);
  });
});

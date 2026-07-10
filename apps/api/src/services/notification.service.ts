// Notification service — the single seam for creating in-app notifications.
// Writes the row AND publishes to the realtime `notification:user:<userId>`
// channel (best-effort; a publish failure never blocks the originating write).
// All callers go through createNotification so emit logic stays consistent and
// org-scoped.
import { prisma } from '@bidstack/db';
import type { NotificationType } from '@bidstack/shared';

import { publish } from './realtime.service.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger({ name: 'notification' });

// Notification types a user can switch off in Settings. assignment/bid_override/
// system are operationally important and always delivered. emailDigest gates a
// feature that doesn't emit in-app notifications (yet).
const GATED_BY_PREF: Partial<
  Record<NotificationType, 'mentionPush' | 'dealStageChange' | 'taskDueSoon'>
> = {
  mention: 'mentionPush',
  stage_change: 'dealStageChange',
  task_due: 'taskDueSoon',
};

export interface CreateNotificationInput {
  orgId: string;
  userId: string;
  type: NotificationType;
  title: string;
  body?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  url?: string | null;
}

/** Create one notification + push it on the user's realtime channel. */
export async function createNotification(input: CreateNotificationInput): Promise<void> {
  // Respect the user's notification preferences for the gateable types. Absent
  // a prefs row the default is to deliver (matching prior behaviour); only an
  // explicit opt-out (flag === false) suppresses the notification.
  const prefKey = GATED_BY_PREF[input.type];
  if (prefKey) {
    const pref = await prisma.notificationPref.findUnique({
      where: { userId: input.userId },
    });
    if (pref && pref[prefKey] === false) return;
  }
  const row = await prisma.notification.create({
    data: {
      orgId: input.orgId,
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      url: input.url ?? null,
    },
  });
  // Fire-and-forget realtime push — subscribers (when the web client connects
  // the channel) get it live; pollers pick it up on their next fetch regardless.
  void publish(`notification:user:${input.userId}`, 'notification', {
    id: row.id,
    type: row.type,
    title: row.title,
    url: row.url,
  }).catch((err) => log.warn({ err, userId: input.userId }, 'notification publish failed'));
}

/**
 * Fan out the same notification to several users (e.g. directors on a bid
 * override). Skips an optional excludeUserId so an actor isn't notified of
 * their own action. Best-effort per user.
 */
export async function notifyUsers(
  base: Omit<CreateNotificationInput, 'userId'> & { userIds: string[]; excludeUserId?: string },
): Promise<void> {
  const targets = [...new Set(base.userIds)].filter((id) => id && id !== base.excludeUserId);
  await Promise.all(
    targets.map((userId) =>
      createNotification({ ...base, userId }).catch((err) =>
        log.warn({ err, userId }, 'notifyUsers: one notification failed'),
      ),
    ),
  );
}

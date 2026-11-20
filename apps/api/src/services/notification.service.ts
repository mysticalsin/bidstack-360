// Notification service — the single seam for creating in-app notifications.
// Writes the row AND publishes to the realtime `notification:user:<userId>`
// channel (best-effort; a publish failure never blocks the originating write).
// All callers go through createNotification so emit logic stays consistent and
// org-scoped. Email and Teams copies go through the notification-delivery queue
// when the user turned that channel on for the kind group.
import { prisma } from '@bidstack/db';
import {
  groupForNotificationType,
  resolveChannelGroups,
  type ChannelToggles,
  type NotificationType,
} from '@bidstack/shared';

import { publish } from './realtime.service.js';
import { enqueueNotificationDelivery } from '../queues/notification-delivery.js';
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

const ALWAYS_IN_APP: ChannelToggles = { in_app: true, email: false, teams: false };

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

export interface NotificationPrefRow {
  channelPrefs: unknown;
  teamsWebhookEnc: string | null;
}

export interface RealtimeNotification {
  id: string;
  type: string;
  title: string;
  body?: string | null;
  url: string | null;
  count?: number;
}

export function publishNotification(userId: string, data: RealtimeNotification): void {
  // Fire-and-forget realtime push — subscribers get it live; pollers pick it
  // up on their next fetch regardless.
  void publish(`notification:user:${userId}`, 'notification', data).catch((err) =>
    log.warn({ err, userId }, 'notification publish failed'),
  );
}

/** Queue the email and Teams copies the user asked for. Never throws. */
export async function enqueueExternalCopies(input: {
  orgId: string;
  userId: string;
  toggles: ChannelToggles;
  pref: NotificationPrefRow | null;
  notificationId: string | null;
  companyId: string | null;
  title: string;
  body: string | null;
  url: string | null;
}): Promise<void> {
  const base = {
    kind: 'deliver' as const,
    orgId: input.orgId,
    userId: input.userId,
    notificationId: input.notificationId,
    companyId: input.companyId,
    title: input.title,
    body: input.body,
    url: input.url,
  };
  if (input.toggles.email) await enqueueNotificationDelivery({ ...base, channel: 'email' });
  if (input.toggles.teams && input.pref?.teamsWebhookEnc) {
    await enqueueNotificationDelivery({ ...base, channel: 'teams' });
  }
}

/** Create one notification + push it on the user's realtime channel. */
export async function createNotification(input: CreateNotificationInput): Promise<void> {
  // Respect the user's notification preferences for the gateable types. Absent
  // a prefs row the default is to deliver (matching prior behaviour); only an
  // explicit opt-out (flag === false) suppresses the notification.
  const prefKey = GATED_BY_PREF[input.type];
  const group = groupForNotificationType(input.type);
  const pref =
    prefKey || group
      ? await prisma.notificationPref.findUnique({ where: { userId: input.userId } })
      : null;
  if (prefKey && pref && pref[prefKey] === false) return;
  const toggles = group ? resolveChannelGroups(pref?.channelPrefs)[group] : ALWAYS_IN_APP;

  let rowId: string | null = null;
  if (toggles.in_app) {
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
    rowId = row.id;
    publishNotification(input.userId, {
      id: row.id,
      type: row.type,
      title: row.title,
      body: row.body,
      url: row.url,
    });
  }
  await enqueueExternalCopies({
    orgId: input.orgId,
    userId: input.userId,
    toggles,
    pref: pref ?? null,
    notificationId: rowId,
    companyId: null,
    title: input.title,
    body: input.body ?? null,
    url: input.url ?? null,
  });
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

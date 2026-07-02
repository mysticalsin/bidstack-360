// In-app notification center wire schemas.
import { z } from 'zod';

export const NotificationType = z.enum([
  'mention',
  'assignment',
  'bid_override',
  'stage_change',
  'task_due',
  'system',
]);
export type NotificationType = z.infer<typeof NotificationType>;

export const Notification = z.object({
  id: z.string().uuid(),
  type: NotificationType,
  title: z.string(),
  body: z.string().nullable(),
  entityType: z.string().nullable(),
  entityId: z.string().nullable(),
  url: z.string().nullable(),
  readAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type Notification = z.infer<typeof Notification>;

export const NotificationPage = z.object({
  items: z.array(Notification),
  unread: z.number().int().nonnegative(),
});
export type NotificationPage = z.infer<typeof NotificationPage>;

// Per-user notification preferences, persisted server-side (one row per user).
// mentionPush gates `mention` notifications; dealStageChange gates
// `stage_change`; taskDueSoon gates `task_due` (the worker cron's task
// due-soon/overdue nudge). emailDigest persists for the (not-yet-built) digest
// email.
export const NotificationPrefs = z.object({
  emailDigest: z.boolean(),
  mentionPush: z.boolean(),
  taskDueSoon: z.boolean(),
  dealStageChange: z.boolean(),
});
export type NotificationPrefs = z.infer<typeof NotificationPrefs>;

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  emailDigest: true,
  mentionPush: true,
  taskDueSoon: true,
  dealStageChange: false,
};

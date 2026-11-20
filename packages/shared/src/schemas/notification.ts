// In-app notification center wire schemas.
import { z } from 'zod';

export const NotificationType = z.enum([
  'mention',
  'assignment',
  'bid_override',
  // Amaris Bid Office: a formal governance gate was signed off (Go/No-Go,
  // Bid/No-Bid, or a C4 gate). Deliberately NOT pref-gated — a gate is a
  // committee decision the owner and bid leads are accountable for, not a
  // convenience ping.
  'gate_decision',
  'stage_change',
  'task_due',
  'system',
  // Something happened on an account the user follows (team, owner or explicit).
  'account_activity',
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

// Per kind group, per channel delivery. Stored as JSON on NotificationPref;
// resolveChannelPrefs (account-alerts) fills gaps with the defaults below.
export const NotificationKindGroup = z.enum(['account_activity', 'deals', 'tasks', 'mentions']);
export type NotificationKindGroup = z.infer<typeof NotificationKindGroup>;

export const NotificationChannel = z.enum(['in_app', 'email', 'teams']);
export type NotificationChannel = z.infer<typeof NotificationChannel>;

export const ChannelToggles = z.object({
  in_app: z.boolean(),
  email: z.boolean(),
  teams: z.boolean(),
});
export type ChannelToggles = z.infer<typeof ChannelToggles>;

export const NotificationChannelGroups = z.object({
  account_activity: ChannelToggles,
  deals: ChannelToggles,
  tasks: ChannelToggles,
  mentions: ChannelToggles,
});
export type NotificationChannelGroups = z.infer<typeof NotificationChannelGroups>;

export const NotificationChannelPrefs = z.object({
  groups: NotificationChannelGroups,
  /** One email a day summarising account alerts, independent of instant email. */
  dailyDigest: z.boolean(),
});
export type NotificationChannelPrefs = z.infer<typeof NotificationChannelPrefs>;

export const NotificationChannelSettings = NotificationChannelPrefs.extend({
  teamsWebhook: z.object({
    configured: z.boolean(),
    host: z.string().nullable(),
  }),
});
export type NotificationChannelSettings = z.infer<typeof NotificationChannelSettings>;

export const TeamsWebhookInput = z.object({
  url: z.string().trim().url().max(2000),
});
export type TeamsWebhookInput = z.infer<typeof TeamsWebhookInput>;

export const TeamsWebhookTestResult = z.object({
  ok: z.boolean(),
  status: z.number().int().nullable(),
  message: z.string(),
});
export type TeamsWebhookTestResult = z.infer<typeof TeamsWebhookTestResult>;

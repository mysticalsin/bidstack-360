// In-app notification center wire schemas.
import { z } from 'zod';

export const NotificationType = z.enum([
  'mention',
  'assignment',
  'bid_override',
  'stage_change',
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

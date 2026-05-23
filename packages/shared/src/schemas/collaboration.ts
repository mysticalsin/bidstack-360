import { z } from 'zod';

export const Comment = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  targetType: z.string(),
  targetId: z.string().uuid(),
  authorUserId: z.string().uuid(),
  authorName: z.string().nullable(),
  bodyMd: z.string(),
  parentId: z.string().uuid().nullable(),
  resolvedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Comment = z.infer<typeof Comment>;

export const CommentCreate = z.object({
  targetType: z.string().min(1).max(50),
  targetId: z.string().uuid(),
  bodyMd: z.string().min(1).max(10000),
  parentId: z.string().uuid().optional(),
});
export type CommentCreate = z.infer<typeof CommentCreate>;

export const Mention = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  commentId: z.string().uuid(),
  userId: z.string().uuid(),
  readAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type Mention = z.infer<typeof Mention>;

export const UserPresence = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  userId: z.string().uuid(),
  userName: z.string().nullable(),
  status: z.enum(['online', 'away', 'busy', 'offline']),
  currentRecordType: z.string().nullable(),
  currentRecordId: z.string().uuid().nullable(),
  lastSeenAt: z.string().datetime(),
});
export type UserPresence = z.infer<typeof UserPresence>;

export const PresenceUpdate = z.object({
  status: z.enum(['online', 'away', 'busy', 'offline']).optional(),
  currentRecordType: z.string().max(50).optional(),
  currentRecordId: z.string().uuid().optional(),
});
export type PresenceUpdate = z.infer<typeof PresenceUpdate>;

import { z } from 'zod';

export const Comment = z.object({
  id: z.string().guid(),
  orgId: z.string().guid(),
  targetType: z.string(),
  targetId: z.string().guid(),
  authorUserId: z.string().guid(),
  authorName: z.string().nullable(),
  bodyMd: z.string(),
  parentId: z.string().guid().nullable(),
  resolvedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Comment = z.infer<typeof Comment>;

export const CommentCreate = z.object({
  targetType: z.string().min(1).max(50),
  targetId: z.string().guid(),
  bodyMd: z.string().min(1).max(10000),
  parentId: z.string().guid().optional(),
});
export type CommentCreate = z.infer<typeof CommentCreate>;

export const Mention = z.object({
  id: z.string().guid(),
  orgId: z.string().guid(),
  commentId: z.string().guid(),
  userId: z.string().guid(),
  readAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type Mention = z.infer<typeof Mention>;

export const MentionSummary = z.object({
  unread: z.number().int().nonnegative(),
});
export type MentionSummary = z.infer<typeof MentionSummary>;

export const UserPresence = z.object({
  id: z.string().guid(),
  orgId: z.string().guid(),
  userId: z.string().guid(),
  userName: z.string().nullable(),
  status: z.enum(['online', 'away', 'busy', 'offline']),
  currentRecordType: z.string().nullable(),
  currentRecordId: z.string().guid().nullable(),
  lastSeenAt: z.string().datetime(),
});
export type UserPresence = z.infer<typeof UserPresence>;

export const PresenceUpdate = z.object({
  status: z.enum(['online', 'away', 'busy', 'offline']).optional(),
  currentRecordType: z.string().max(50).optional(),
  currentRecordId: z.string().guid().optional(),
});
export type PresenceUpdate = z.infer<typeof PresenceUpdate>;

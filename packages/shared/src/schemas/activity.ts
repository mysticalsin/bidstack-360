import { z } from 'zod';

export const ActivityType = z.enum(['email', 'meeting', 'call', 'note', 'task']);
export const ActivityStatus = z.enum(['planned', 'completed', 'cancelled']);

export const Activity = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  type: ActivityType,
  subject: z.string().nullable(),
  description: z.string().nullable(),
  startTime: z.string().datetime().nullable(),
  endTime: z.string().datetime().nullable(),
  status: ActivityStatus,
  entityType: z.string(),
  entityId: z.string().uuid(),
  ownerId: z.string().uuid().nullable(),
  metadata: z.record(z.unknown()).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const ActivityCreate = z.object({
  type: ActivityType,
  subject: z.string().max(500).optional(),
  description: z.string().max(10000).optional(),
  startTime: z.string().datetime().optional(),
  endTime: z.string().datetime().optional(),
  status: ActivityStatus.optional(),
  entityType: z.string().min(1).max(50),
  entityId: z.string().uuid(),
  ownerId: z.string().uuid().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const ActivityPatch = z.object({
  type: ActivityType.optional(),
  subject: z.string().max(500).optional().nullable(),
  description: z.string().max(10000).optional().nullable(),
  startTime: z.string().datetime().optional().nullable(),
  endTime: z.string().datetime().optional().nullable(),
  status: ActivityStatus.optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const ActivityFilter = z.object({
  entityType: z.string().optional(),
  entityId: z.string().uuid().optional(),
  type: ActivityType.optional(),
  status: ActivityStatus.optional(),
  ownerId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export const ActivityList = z.object({
  items: z.array(Activity),
  total: z.number().int(),
});

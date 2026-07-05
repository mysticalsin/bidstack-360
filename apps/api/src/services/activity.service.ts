import { prisma, type Prisma } from '@bidstack/db';
import type { z } from 'zod';

import type { ActivityType } from '@bidstack/shared';

export type ActivityEventType = z.infer<typeof ActivityType>;

type ActivityActorType = 'user' | 'system' | 'agent';

interface LogActivityInput {
  orgId: string;
  entityType: string;
  entityId: string;
  type: ActivityEventType;
  actorId?: string | null;
  actorType?: ActivityActorType;
  subject?: string | null;
  description?: string | null;
  startTime?: Date | null;
  endTime?: Date | null;
  status?: 'planned' | 'completed' | 'cancelled';
  metadata?: Record<string, unknown>;
  body?: Record<string, unknown>;
  occurredAt?: Date;
  idempotencyKey?: string;
}

interface TimelineInput {
  orgId: string;
  entityType: string;
  entityId: string;
  cursor?: string;
  limit: number;
  typeFilter?: ActivityEventType[];
}

type ActivityRow = NonNullable<Awaited<ReturnType<typeof prisma.activity.findFirst>>>;

export async function logActivity(input: LogActivityInput) {
  const metadata: Prisma.InputJsonObject | undefined = input.idempotencyKey
    ? { idempotencyKey: input.idempotencyKey }
    : undefined;

  const data = {
    orgId: input.orgId,
    type: input.type,
    subject: input.subject ?? null,
    description: input.description ?? null,
    startTime: input.startTime ?? null,
    endTime: input.endTime ?? null,
    status: input.status ?? 'completed',
    entityType: input.entityType,
    entityId: input.entityId,
    ownerId: input.actorType === 'user' ? input.actorId ?? null : null,
    actorId: input.actorId ?? null,
    actorType: input.actorType ?? 'user',
    body: (input.body ?? {}) as Prisma.InputJsonObject,
    metadata: (input.metadata ?? metadata) as Prisma.InputJsonObject | undefined,
    occurredAt: input.occurredAt ?? new Date(),
    idempotencyKey: input.idempotencyKey,
  };

  // Idempotency under concurrency: find-then-create raced (two callers replaying
  // the same key could both insert). Upsert on the unique idempotencyKey is a
  // single atomic statement — a concurrent duplicate hits the where branch and
  // returns the existing row unchanged (empty update = no-op).
  if (input.idempotencyKey) {
    return prisma.activity.upsert({
      where: { idempotencyKey: input.idempotencyKey },
      create: data,
      update: {},
      select: { id: true },
    });
  }

  return prisma.activity.create({
    data,
    select: { id: true },
  });
}

// Compound pagination cursor "<occurredAt ISO>|<id>". occurredAt carries no
// uniqueness guarantee (concurrent writes land on the same millisecond), so a
// timestamp-only cursor with a strict `lt` permanently skipped rows that
// shared the boundary timestamp — they were never on the emitting page and the
// next page excluded them too. The id half breaks the tie; opaque to clients.
export function encodeActivityCursor(row: { occurredAt: Date; id: string }): string {
  return `${row.occurredAt.toISOString()}|${row.id}`;
}

export function activityCursorWhere(cursor: string): Prisma.ActivityWhereInput {
  const sep = cursor.indexOf('|');
  // Legacy bare-ISO cursors (issued before the tiebreaker existed) degrade to
  // the old timestamp-only paging instead of erroring mid-scroll.
  if (sep === -1) return { occurredAt: { lt: new Date(cursor) } };
  const occurredAt = new Date(cursor.slice(0, sep));
  const id = cursor.slice(sep + 1);
  return {
    OR: [{ occurredAt: { lt: occurredAt } }, { occurredAt, id: { lt: id } }],
  };
}

export async function getTimeline(input: TimelineInput) {
  const rows = await prisma.activity.findMany({
    where: {
      orgId: input.orgId,
      entityType: input.entityType,
      entityId: input.entityId,
      deletedAt: null,
      ...(input.cursor ? activityCursorWhere(input.cursor) : {}),
      ...(input.typeFilter?.length ? { type: { in: input.typeFilter } } : {}),
    },
    // id tiebreaker matches the compound cursor above — ordering must be total
    // or ties at a page boundary are returned twice or not at all.
    orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    take: input.limit + 1,
  });

  const pageRows = rows.slice(0, input.limit);
  const last = pageRows.at(-1);
  const next = rows.length > input.limit && last ? encodeActivityCursor(last) : null;

  return {
    items: pageRows.map(serializeTimelineActivity),
    nextCursor: next,
  };
}

function serializeTimelineActivity(row: ActivityRow) {
  return {
    id: row.id,
    orgId: row.orgId,
    type: row.type,
    subject: row.subject,
    description: row.description,
    startTime: row.startTime?.toISOString() ?? null,
    endTime: row.endTime?.toISOString() ?? null,
    status: row.status,
    entityType: row.entityType,
    entityId: row.entityId,
    ownerId: row.ownerId,
    metadata: (row.metadata as Record<string, unknown>) ?? null,
    actorId: row.actorId,
    actorType: row.actorType,
    body: (row.body as Record<string, unknown>) ?? null,
    occurredAt: row.occurredAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

import { z } from 'zod';

import { prisma, type TaskStatus as PrismaTaskStatus } from '@bidstack/db';

import type { Tool } from './index.js';

const Input = z.object({
  oppId: z.string().uuid().optional(),
  status: z.enum(['open', 'in_progress', 'done', 'blocked']).optional(),
  assignee: z.string().email().optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

export const tasksList: Tool<typeof Input> = {
  description: 'List tasks, optionally filtered by opportunity, status, or assignee.',
  input: Input,
  inputJsonSchema: {
    type: 'object',
    properties: {
      oppId: { type: 'string', format: 'uuid' },
      status: { type: 'string', enum: ['open', 'in_progress', 'done', 'blocked'] },
      assignee: { type: 'string', format: 'email' },
      limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
    },
    additionalProperties: false,
  },
  handler: async (args, ctx) => {
    const assignee = args.assignee
      ? await prisma.user.findFirst({
          where: { orgId: ctx.orgId, email: args.assignee },
        })
      : null;

    const items = await prisma.task.findMany({
      where: {
        orgId: ctx.orgId,
        deletedAt: null, // skip soft-deleted (Review)
        ...(args.oppId ? { oppId: args.oppId } : {}),
        ...(args.status ? { status: args.status as PrismaTaskStatus } : {}),
        ...(assignee ? { assigneeId: assignee.id } : {}),
      },
      include: { opportunity: true, assignee: true },
      orderBy: { createdAt: 'desc' },
      take: args.limit,
    });

    return items.map((t) => ({
      id: t.id,
      oppId: t.oppId,
      oppName: t.opportunity?.name ?? null,
      title: t.title,
      status: t.status,
      dueDate: t.dueDate?.toISOString().slice(0, 10) ?? null,
      assignee: t.assignee?.email ?? null,
      createdAt: t.createdAt.toISOString(),
    }));
  },
};

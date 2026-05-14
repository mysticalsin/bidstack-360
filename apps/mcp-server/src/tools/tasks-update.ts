import { z } from 'zod';

import { prisma, type TaskStatus as PrismaTaskStatus } from '@bidstack/db';

import type { Tool } from './index.js';

const Input = z.object({
  id: z.string().uuid(),
  status: z.enum(['open', 'in_progress', 'done', 'blocked']).optional(),
  title: z.string().min(1).max(200).optional(),
  dueDate: z.string().date().nullable().optional(),
  assignee: z.string().email().nullable().optional(),
});

export const tasksUpdate: Tool<typeof Input> = {
  description: 'Update a task status, title, due date, or assignee.',
  input: Input,
  inputJsonSchema: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', format: 'uuid' },
      status: { type: 'string', enum: ['open', 'in_progress', 'done', 'blocked'] },
      title: { type: 'string', minLength: 1, maxLength: 200 },
      dueDate: { type: ['string', 'null'], format: 'date' },
      assignee: { type: ['string', 'null'], format: 'email' },
    },
    additionalProperties: false,
  },
  handler: async (args, ctx) => {
    const before = await prisma.task.findFirst({
      where: { id: args.id, orgId: ctx.orgId },
    });
    if (!before) throw new Error('Task not found');

    let assigneeId: string | null | undefined = undefined;
    if (args.assignee !== undefined) {
      if (args.assignee === null) {
        assigneeId = null;
      } else {
        const user = await prisma.user.findFirst({
          where: { orgId: ctx.orgId, email: args.assignee },
        });
        assigneeId = user?.id ?? null;
      }
    }

    const updated = await prisma.task.update({
      where: { id: before.id },
      data: {
        ...(args.status !== undefined ? { status: args.status as PrismaTaskStatus } : {}),
        ...(args.title !== undefined ? { title: args.title } : {}),
        ...(args.dueDate !== undefined
          ? { dueDate: args.dueDate ? new Date(args.dueDate) : null }
          : {}),
        ...(assigneeId !== undefined ? { assigneeId } : {}),
      },
      include: { assignee: true },
    });

    await prisma.auditLog.create({
      data: {
        orgId: ctx.orgId,
        action: 'task.update.mcp',
        targetType: 'task',
        targetId: updated.id,
        diff: {
          status: args.status,
          title: args.title,
          dueDate: args.dueDate,
          assignee: args.assignee,
        },
      },
    });

    return {
      id: updated.id,
      title: updated.title,
      status: updated.status,
      dueDate: updated.dueDate?.toISOString().slice(0, 10) ?? null,
      assignee: updated.assignee?.email ?? null,
    };
  },
};

import { z } from 'zod';

import { prisma } from '@bidstack/db';

import type { Tool } from './index.js';

const Input = z.object({
  oppId: z.string().uuid(),
  title: z.string().min(1).max(200),
  dueDate: z.string().date().optional(),
  assignee: z.string().email().optional(),
});

export const tasksCreate: Tool<typeof Input> = {
  description: 'Create a follow-up task on an opportunity.',
  input: Input,
  inputJsonSchema: {
    type: 'object',
    required: ['oppId', 'title'],
    properties: {
      oppId: { type: 'string', format: 'uuid' },
      title: { type: 'string', minLength: 1, maxLength: 200 },
      dueDate: { type: 'string', format: 'date' },
      assignee: { type: 'string', format: 'email' },
    },
    additionalProperties: false,
  },
  handler: async (args, ctx) => {
    const opp = await prisma.opportunity.findFirst({
      where: { id: args.oppId, orgId: ctx.orgId, deletedAt: null }, // skip soft-deleted (Review)
    });
    if (!opp) throw new Error('Opportunity not found');

    const assignee = args.assignee
      ? await prisma.user.findFirst({
          where: { orgId: ctx.orgId, email: args.assignee },
        })
      : null;

    const created = await prisma.task.create({
      data: {
        orgId: ctx.orgId,
        oppId: opp.id,
        title: args.title,
        dueDate: args.dueDate ? new Date(args.dueDate) : null,
        assigneeId: assignee?.id ?? null,
      },
    });

    await prisma.auditLog.create({
      data: {
        orgId: ctx.orgId,
        userId: null,
        action: 'task.create',
        targetType: 'task',
        targetId: created.id,
        diff: {
          title: args.title,
          dueDate: args.dueDate,
          assignee: args.assignee,
          oppId: args.oppId,
        },
      },
    });

    return {
      id: created.id,
      oppId: created.oppId,
      title: created.title,
      dueDate: created.dueDate?.toISOString().slice(0, 10) ?? null,
      status: created.status,
      assignee: assignee?.email ?? null,
      createdAt: created.createdAt.toISOString(),
    };
  },
};

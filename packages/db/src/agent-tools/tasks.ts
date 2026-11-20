import { z } from 'zod';

import { prisma } from '../index.js';

import { isoDate, oppCitation, type AgentTool } from './types.js';

const Input = z.object({
  oppId: z.string().uuid(),
  title: z.string().min(1).max(200),
  dueDate: z.string().date().optional(),
  assignee: z.string().email().optional(),
});

async function findOpp(orgId: string, oppId: string) {
  const opp = await prisma.opportunity.findFirst({
    where: { id: oppId, orgId, deletedAt: null }, // skip soft-deleted (Review)
  });
  if (!opp) throw new Error('Opportunity not found');
  return opp;
}

export const tasksCreate: AgentTool<typeof Input> = {
  description: 'Create a follow-up task on an opportunity.',
  input: Input,
  kind: 'write',
  permission: 'tasks:write',
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
  preview: async (args, ctx) => {
    const opp = await findOpp(ctx.orgId, args.oppId);
    return {
      title: 'Create task',
      changes: [
        { field: 'Title', value: args.title },
        { field: 'Due date', value: args.dueDate ?? 'none' },
        { field: 'Opportunity', value: `${opp.code} ${opp.name}` },
        { field: 'Assignee', value: args.assignee ?? 'unassigned' },
      ],
      citation: oppCitation(opp),
    };
  },
  handler: async (args, ctx) => {
    const opp = await findOpp(ctx.orgId, args.oppId);

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
        userId: ctx.userId ?? null,
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
      dueDate: isoDate(created.dueDate),
      status: created.status,
      assignee: assignee?.email ?? null,
      createdAt: created.createdAt.toISOString(),
    };
  },
};

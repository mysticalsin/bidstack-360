import { z } from 'zod';

import { prisma, type OpportunityStage as PrismaStage } from '@bidstack/db';

import type { Tool } from './index.js';

const Stage = z.enum([
  'discovery',
  'qualified',
  'proposal',
  'negotiation',
  'closed_won',
  'closed_lost',
]);

const Patch = z.object({
  stage: Stage.optional(),
  probability: z.number().int().min(0).max(100).optional(),
  value: z.number().nonnegative().optional(),
  dueDate: z.string().date().nullable().optional(),
  customer: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  industry: z.string().nullable().optional(),
});

const Input = z.object({
  id: z.string().uuid(),
  patch: Patch,
});

export const opportunityUpdate: Tool<typeof Input> = {
  description:
    'Patch an opportunity. Common use: agent updates stage, probability, or value. Writes audit_log.',
  input: Input,
  inputJsonSchema: {
    type: 'object',
    required: ['id', 'patch'],
    properties: {
      id: { type: 'string', format: 'uuid' },
      patch: {
        type: 'object',
        properties: {
          stage: {
            type: 'string',
            enum: [
              'discovery',
              'qualified',
              'proposal',
              'negotiation',
              'closed_won',
              'closed_lost',
            ],
          },
          probability: { type: 'integer', minimum: 0, maximum: 100 },
          value: { type: 'number', minimum: 0 },
          dueDate: { type: ['string', 'null'], format: 'date' },
          customer: { type: 'string', minLength: 1 },
          name: { type: 'string', minLength: 1 },
          industry: { type: ['string', 'null'] },
        },
        additionalProperties: false,
      },
    },
  },
  handler: async (args, ctx) => {
    const before = await prisma.opportunity.findFirst({
      where: { id: args.id, orgId: ctx.orgId },
    });
    if (!before) throw new Error('Opportunity not found');

    const { patch } = args;
    const updated = await prisma.opportunity.update({
      where: { id: before.id },
      data: {
        ...(patch.stage ? { stage: patch.stage as PrismaStage } : {}),
        ...(patch.probability !== undefined ? { probability: patch.probability } : {}),
        ...(patch.value !== undefined ? { valueEur: patch.value } : {}),
        ...(patch.dueDate !== undefined
          ? { dueDate: patch.dueDate ? new Date(patch.dueDate) : null }
          : {}),
        ...(patch.customer ? { customer: patch.customer } : {}),
        ...(patch.name ? { name: patch.name } : {}),
        ...(patch.industry !== undefined ? { industry: patch.industry } : {}),
      },
      include: { owner: true },
    });

    await prisma.auditLog.create({
      data: {
        orgId: ctx.orgId,
        action: 'opportunity.update.mcp',
        targetType: 'opportunity',
        targetId: updated.id,
        diff: patch,
      },
    });

    return {
      id: updated.id,
      code: updated.code,
      customer: updated.customer,
      name: updated.name,
      stage: updated.stage,
      value: Number(updated.valueEur),
      probability: updated.probability,
      dueDate: updated.dueDate?.toISOString().slice(0, 10) ?? null,
      owner: updated.owner?.email ?? null,
      industry: updated.industry,
      updatedAt: updated.updatedAt.toISOString(),
    };
  },
};

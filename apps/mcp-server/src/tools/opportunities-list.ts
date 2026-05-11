import { z } from 'zod';

import { prisma, type OpportunityStage as PrismaStage } from '@bidstack/db';

import type { Tool } from './index.js';

const Input = z.object({
  stage: z
    .enum(['discovery', 'qualified', 'proposal', 'negotiation', 'closed_won', 'closed_lost'])
    .optional(),
  owner: z.string().email().optional(),
  industry: z.string().optional(),
  search: z.string().optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

export const opportunitiesList: Tool<typeof Input> = {
  description: 'List opportunities matching filters (stage/owner/industry/search).',
  input: Input,
  inputJsonSchema: {
    type: 'object',
    properties: {
      stage: {
        type: 'string',
        enum: ['discovery', 'qualified', 'proposal', 'negotiation', 'closed_won', 'closed_lost'],
      },
      owner: { type: 'string', format: 'email' },
      industry: { type: 'string' },
      search: { type: 'string' },
      limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
    },
    additionalProperties: false,
  },
  handler: async (args, ctx) => {
    const items = await prisma.opportunity.findMany({
      where: {
        orgId: ctx.orgId,
        ...(args.stage ? { stage: args.stage as PrismaStage } : {}),
        ...(args.industry ? { industry: args.industry } : {}),
        ...(args.owner ? { owner: { email: args.owner } } : {}),
        ...(args.search
          ? {
              OR: [
                { customer: { contains: args.search, mode: 'insensitive' } },
                { name: { contains: args.search, mode: 'insensitive' } },
                { code: { contains: args.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: { owner: true },
      orderBy: { updatedAt: 'desc' },
      take: args.limit,
    });
    return items.map((o) => ({
      id: o.id,
      code: o.code,
      customer: o.customer,
      name: o.name,
      stage: o.stage,
      value: Number(o.valueEur),
      probability: o.probability,
      dueDate: o.dueDate?.toISOString().slice(0, 10) ?? null,
      owner: o.owner?.email ?? null,
      industry: o.industry,
      updatedAt: o.updatedAt.toISOString(),
    }));
  },
};

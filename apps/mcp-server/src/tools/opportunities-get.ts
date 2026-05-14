import { z } from 'zod';

import { prisma } from '@bidstack/db';

import type { Tool } from './index.js';

const Input = z
  .object({
    id: z.string().uuid().optional(),
    code: z
      .string()
      .regex(/^OP-\d{4}$/)
      .optional(),
  })
  .refine((v) => v.id || v.code, { message: 'Provide either id or code' });

export const opportunitiesGet: Tool<typeof Input> = {
  description:
    'Fetch one opportunity with full intel payload (financials, triggers, decision unit, competitors, news, hiring, win prediction).',
  input: Input,
  inputJsonSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      code: { type: 'string', pattern: '^OP-\\d{4}$' },
    },
    additionalProperties: false,
  },
  handler: async (args, ctx) => {
    const opp = await prisma.opportunity.findFirst({
      where: {
        orgId: ctx.orgId,
        ...(args.id ? { id: args.id } : { code: args.code }),
      },
      include: {
        owner: true,
        tasks: { orderBy: { createdAt: 'desc' }, take: 50 },
        documents: { orderBy: { createdAt: 'desc' }, take: 50 },
      },
    });
    if (!opp) throw new Error('Opportunity not found');
    return {
      id: opp.id,
      code: opp.code,
      customer: opp.customer,
      name: opp.name,
      stage: opp.stage,
      value: Number(opp.valueMicros) / 1_000_000,
      probability: opp.probability,
      dueDate: opp.dueDate?.toISOString().slice(0, 10) ?? null,
      owner: opp.owner?.email ?? null,
      industry: opp.industry,
      intel: opp.intel,
      tasks: opp.tasks.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        dueDate: t.dueDate?.toISOString().slice(0, 10) ?? null,
      })),
      documents: opp.documents.map((d) => ({ id: d.id, name: d.name, kind: d.kind })),
    };
  },
};

import { z } from 'zod';

import { prisma } from '@bidstack/db';

import type { Tool } from './index.js';

const Input = z.object({
  sector: z.string().optional(),
  category: z.string().optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

export const salesToolkitsList: Tool<typeof Input> = {
  description:
    'List stored sales toolkits (decks, templates, battle-cards, case studies, playbooks), optionally filtered by sector tag or category. Use these to find pitch collateral for an account or sector.',
  input: Input,
  inputJsonSchema: {
    type: 'object',
    properties: {
      sector: { type: 'string', description: 'Filter by a sector tag, e.g. "Healthcare".' },
      category: {
        type: 'string',
        enum: ['deck', 'template', 'battlecard', 'casestudy', 'playbook', 'other'],
      },
      limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
    },
    additionalProperties: false,
  },
  handler: async (args, ctx) => {
    const items = await prisma.salesToolkit.findMany({
      where: {
        orgId: ctx.orgId,
        deletedAt: null, // never surface soft-deleted rows to agents
        ...(args.category ? { category: args.category } : {}),
        ...(args.sector ? { sectorTags: { has: args.sector } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: args.limit,
    });
    return items.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      category: t.category,
      sectorTags: t.sectorTags,
      url: t.url,
      source: t.source,
      createdAt: t.createdAt.toISOString(),
    }));
  },
};

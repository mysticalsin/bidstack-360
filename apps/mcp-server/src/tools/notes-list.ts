import { z } from 'zod';

import { prisma } from '@bidstack/db';

import type { Tool } from './index.js';

const Input = z.object({
  accountId: z.string().min(1),
  limit: z.number().int().min(1).max(100).default(25),
});

export const notesList: Tool<typeof Input> = {
  description: 'List notes for a customer account, newest first.',
  input: Input,
  inputJsonSchema: {
    type: 'object',
    required: ['accountId'],
    properties: {
      accountId: { type: 'string', minLength: 1 },
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
    },
    additionalProperties: false,
  },
  handler: async (args, ctx) => {
    const items = await prisma.note.findMany({
      where: { orgId: ctx.orgId, accountId: args.accountId, deletedAt: null }, // skip soft-deleted (Review)
      include: { author: true },
      orderBy: { createdAt: 'desc' },
      take: args.limit,
    });

    return items.map((n) => ({
      id: n.id,
      accountId: n.accountId,
      title: n.title,
      bodyMd: n.bodyMd,
      pinned: n.pinned,
      author: n.author?.email ?? null,
      createdAt: n.createdAt.toISOString(),
      updatedAt: n.updatedAt.toISOString(),
    }));
  },
};

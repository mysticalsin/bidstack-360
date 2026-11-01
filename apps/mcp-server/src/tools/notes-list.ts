import { z } from 'zod';

import { prisma } from '@bidstack/db';

import type { Tool } from './index.js';

const Input = z.object({
  accountId: z.string().uuid(),
  limit: z.number().int().min(1).max(100).default(25),
});

export const notesList: Tool<typeof Input> = {
  description:
    'List notes for a company or stored account id (UUID), newest first. The account tag match ignores case. A company name is not resolved. Pass Company.id or the note accountId uuid; org scope is always applied.',
  input: Input,
  inputJsonSchema: {
    type: 'object',
    required: ['accountId'],
    properties: {
      accountId: {
        type: 'string',
        format: 'uuid',
        description: 'Company.id or the stored note account id. Not a company name.',
      },
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
    },
    additionalProperties: false,
  },
  handler: async (args, ctx) => {
    if (!z.string().uuid().safeParse(args.accountId).success) {
      throw new Error(
        'accountId must be a UUID (Company.id or the stored note account id). Company names are not resolved.',
      );
    }
    const accountId = args.accountId.toLowerCase();
    const items = await prisma.note.findMany({
      where: {
        orgId: ctx.orgId,
        deletedAt: null,
        OR: [{ accountId }, { companyId: args.accountId }],
      },
      include: { author: true },
      orderBy: { createdAt: 'desc' },
      take: args.limit,
    });

    return items.map((n) => ({
      id: n.id,
      accountId: n.accountId,
      companyId: n.companyId,
      title: n.title,
      bodyMd: n.bodyMd,
      pinned: n.pinned,
      author: n.author?.email ?? null,
      createdAt: n.createdAt.toISOString(),
      updatedAt: n.updatedAt.toISOString(),
    }));
  },
};

import { z } from 'zod';

import { prisma } from '@bidstack/db';

import type { Tool } from './index.js';

const Input = z.object({
  customer: z.string().optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

export const contactsList: Tool<typeof Input> = {
  description: 'List contacts, optionally filtered by customer name.',
  input: Input,
  inputJsonSchema: {
    type: 'object',
    properties: {
      customer: { type: 'string' },
      limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
    },
    additionalProperties: false,
  },
  handler: async (args, ctx) => {
    const items = await prisma.contact.findMany({
      where: {
        orgId: ctx.orgId,
        deletedAt: null, // never surface soft-deleted rows to agents (Review)
        ...(args.customer ? { customer: args.customer } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: args.limit,
    });
    return items.map((c) => ({
      id: c.id,
      customer: c.customer,
      name: c.name,
      role: c.role,
      // Honor the per-contact AI opt-out — PII must not reach AI agents. (Review.)
      email: c.aiOptOut ? null : c.email,
      phone: c.aiOptOut ? null : c.phone,
      influence: c.influence,
      sentiment: c.sentiment,
      createdAt: c.createdAt.toISOString(),
    }));
  },
};

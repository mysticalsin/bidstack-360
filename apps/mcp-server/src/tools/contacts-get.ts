import { z } from 'zod';

import { prisma } from '@bidstack/db';

import type { Tool } from './index.js';

const Input = z.object({
  id: z.string().uuid(),
});

export const contactsGet: Tool<typeof Input> = {
  description: 'Fetch a single contact by ID.',
  input: Input,
  inputJsonSchema: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', format: 'uuid' },
    },
    additionalProperties: false,
  },
  handler: async (args, ctx) => {
    const contact = await prisma.contact.findFirst({
      where: { id: args.id, orgId: ctx.orgId, deletedAt: null },
    });
    if (!contact) throw new Error('Contact not found');
    return {
      id: contact.id,
      customer: contact.customer,
      name: contact.name,
      role: contact.role,
      // Honor the per-contact AI opt-out — PII must not reach AI agents. (Review.)
      email: contact.aiOptOut ? null : contact.email,
      phone: contact.aiOptOut ? null : contact.phone,
      influence: contact.influence,
      sentiment: contact.sentiment,
      createdAt: contact.createdAt.toISOString(),
    };
  },
};

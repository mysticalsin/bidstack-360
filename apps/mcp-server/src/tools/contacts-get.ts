import { z } from 'zod';

import { prisma } from '@bidstack/db';

import type { Tool } from './index.js';

const Input = z.object({
  id: z.string().uuid(),
});

export const contactsGet: Tool<typeof Input> = {
  description:
    'Fetch one contact. companyId is the company link. linkState is linked or needs_review. The customer text is not a link. Contacts with aiOptOut have null email and phone.',
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
      companyId: contact.companyId,
      linkState: contact.companyId ? ('linked' as const) : ('needs_review' as const),
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

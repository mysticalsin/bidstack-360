import { z } from 'zod';

import { prisma, type Sentiment } from '@bidstack/db';

import type { Tool } from './index.js';
import { isCompanyUuid, requireCompanyLink } from './crm-tools.helpers.js';

const Input = z.object({
  customer: z.string().min(1),
  companyId: z.string().uuid().optional(),
  name: z.string().min(1).max(255),
  role: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  influence: z.number().int().min(0).max(5).optional(),
  sentiment: z.enum(['hot', 'warm', 'neutral', 'cold']).optional(),
});

export const contactsCreate: Tool<typeof Input> = {
  description:
    'Create a contact linked to one company. Pass companyId, or a customer name that matches exactly one company. Influence is 0 to 5.',
  input: Input,
  inputJsonSchema: {
    type: 'object',
    required: ['customer', 'name'],
    properties: {
      customer: { type: 'string', minLength: 1 },
      companyId: { type: 'string', format: 'uuid' },
      name: { type: 'string', minLength: 1, maxLength: 255 },
      role: { type: 'string' },
      email: { type: 'string', format: 'email' },
      phone: { type: 'string' },
      influence: { type: 'integer', minimum: 0, maximum: 5 },
      sentiment: { type: 'string', enum: ['hot', 'warm', 'neutral', 'cold'] },
    },
    additionalProperties: false,
  },
  handler: async (args, ctx) => {
    const company = await requireCompanyLink(ctx.orgId, {
      companyId: args.companyId ?? (isCompanyUuid(args.customer) ? args.customer : undefined),
      name: args.companyId || isCompanyUuid(args.customer) ? undefined : args.customer,
    });
    const created = await prisma.contact.create({
      data: {
        orgId: ctx.orgId,
        customer: company.name,
        companyId: company.id,
        name: args.name,
        role: args.role ?? null,
        email: args.email ?? null,
        phone: args.phone ?? null,
        influence: args.influence ?? null,
        sentiment: (args.sentiment ?? null) as Sentiment | null,
      },
    });

    await prisma.auditLog.create({
      data: {
        orgId: ctx.orgId,
        action: 'contact.create.mcp',
        targetType: 'contact',
        targetId: created.id,
        diff: { customer: args.customer, name: args.name },
      },
    });

    return {
      id: created.id,
      customer: created.customer,
      companyId: created.companyId,
      name: created.name,
      role: created.role,
      email: created.email,
      phone: created.phone,
      influence: created.influence,
      sentiment: created.sentiment,
      createdAt: created.createdAt.toISOString(),
    };
  },
};

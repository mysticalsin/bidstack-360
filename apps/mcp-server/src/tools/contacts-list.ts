import { z } from 'zod';

import { prisma } from '@bidstack/db';

import type { Tool } from './index.js';
import { isCompanyUuid, requireCompanyLink } from './crm-tools.helpers.js';

const Input = z.object({
  companyId: z.string().uuid().optional(),
  customer: z.string().optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

export const contactsList: Tool<typeof Input> = {
  description:
    'List contacts. Pass companyId, or a customer name that matches exactly one company, to return people linked by that company id. An unlinked contact whose customer text matches is not included. Includes linkState. Contacts with aiOptOut have null email and phone.',
  input: Input,
  inputJsonSchema: {
    type: 'object',
    properties: {
      companyId: { type: 'string', format: 'uuid' },
      customer: {
        type: 'string',
        description: 'Company id, or a name that matches exactly one company. Not a free-text customer label.',
      },
      limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
    },
    additionalProperties: false,
  },
  handler: async (args, ctx) => {
    const requested = args.companyId?.trim() || args.customer?.trim() || '';
    const company = requested
      ? await requireCompanyLink(
          ctx.orgId,
          isCompanyUuid(requested) ? { companyId: requested } : { name: requested },
        )
      : null;
    const items = await prisma.contact.findMany({
      where: {
        orgId: ctx.orgId,
        deletedAt: null, // never surface soft-deleted rows to agents (Review)
        ...(company ? { companyId: company.id } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: args.limit,
    });
    return items.map((c) => ({
      id: c.id,
      customer: c.customer,
      name: c.name,
      role: c.role,
      companyId: c.companyId,
      linkState: c.companyId ? ('linked' as const) : ('needs_review' as const),
      // Honor the per-contact AI opt-out — PII must not reach AI agents. (Review.)
      email: c.aiOptOut ? null : c.email,
      phone: c.aiOptOut ? null : c.phone,
      influence: c.influence,
      sentiment: c.sentiment,
      createdAt: c.createdAt.toISOString(),
    }));
  },
};

import { z } from 'zod';

import { prisma } from '@bidstack/db';

import type { Tool } from './index.js';

const Input = z.object({
  id: z.string().uuid(),
});

export const leadsGet: Tool<typeof Input> = {
  description:
    'Fetch one lead with full BANT qualification (budget, authority, need, timeline), score, and intel.',
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
    const lead = await prisma.lead.findFirst({
      where: { id: args.id, orgId: ctx.orgId },
      include: { owner: true },
    });
    if (!lead) throw new Error('Lead not found');
    return {
      id: lead.id,
      firstName: lead.firstName,
      lastName: lead.lastName,
      email: lead.email,
      phone: lead.phone,
      companyName: lead.companyName,
      title: lead.title,
      source: lead.source,
      status: lead.status,
      score: lead.score,
      priority: lead.priority,
      owner: lead.owner?.email ?? null,
      notes: lead.notes,
      budget: lead.budget,
      authority: lead.authority,
      need: lead.need,
      timeline: lead.timeline,
      intel: lead.intel,
      convertedToOpportunityId: lead.convertedToOpportunityId,
      createdAt: lead.createdAt.toISOString(),
      updatedAt: lead.updatedAt.toISOString(),
    };
  },
};

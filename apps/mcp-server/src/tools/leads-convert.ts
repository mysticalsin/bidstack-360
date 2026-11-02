import { z } from 'zod';

import { prisma, type OpportunityStage as PrismaStage } from '@bidstack/db';

import type { Tool } from './index.js';

const Input = z.object({
  id: z.string().uuid(),
  opportunityName: z.string().min(1).max(255).optional(),
  opportunityValueMicros: z.number().min(0).optional(),
  stage: z
    .enum([
      's1_lead',
      's1_ongoing',
      's2_sent',
      's3_technical_iteration',
      's4_negotiation',
      'closed_won',
      'closed_lost',
    ])
    .optional(),
});
const STAGE_OPTIONS = Input.shape.stage.unwrap().options;

export const leadsConvert: Tool<typeof Input> = {
  description: 'Convert a qualified lead into an opportunity and a contact. Writes audit_log.',
  input: Input,
  inputJsonSchema: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', format: 'uuid' },
      opportunityName: { type: 'string', minLength: 1, maxLength: 255 },
      opportunityValueMicros: { type: 'number', minimum: 0 },
      stage: {
        type: 'string',
        enum: STAGE_OPTIONS,
      },
    },
    additionalProperties: false,
  },
  handler: async (args, ctx) => {
    const lead = await prisma.lead.findFirst({
      where: { id: args.id, orgId: ctx.orgId, deletedAt: null }, // skip soft-deleted (Review)
    });
    if (!lead) throw new Error('Lead not found');
    if (lead.convertedToOpportunityId) throw new Error('Lead already converted');

    const last = await prisma.opportunity.findFirst({
      where: { orgId: ctx.orgId, code: { startsWith: 'OP-' } },
      orderBy: { code: 'desc' },
      select: { code: true },
    });
    const code = last
      ? `OP-${(Number(last.code.slice(3)) + 1).toString().padStart(4, '0')}`
      : 'OP-2001';

    const [opp, contact] = await prisma.$transaction([
      prisma.opportunity.create({
        data: {
          orgId: ctx.orgId,
          code,
          customer: lead.companyName,
          name: args.opportunityName ?? `${lead.companyName} — ${lead.firstName} ${lead.lastName}`,
          stage: (args.stage ?? 's1_lead') as PrismaStage,
          valueMicros: BigInt(Math.round(args.opportunityValueMicros ?? 0)),
          probability: 25,
          industry: null,
          intel: {},
        },
      }),
      prisma.contact.create({
        data: {
          orgId: ctx.orgId,
          customer: lead.companyName,
          name: `${lead.firstName} ${lead.lastName}`,
          role: lead.title,
          email: lead.email,
          phone: lead.phone,
        },
      }),
      prisma.lead.update({
        where: { id: lead.id },
        data: {
          status: 'converted',
          convertedToOpportunityId: { set: undefined }, // placeholder — will be set after opp created
        },
      }),
    ]);

    // Update the lead with the correct opportunity ID now that it exists.
    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        status: 'converted',
        convertedToOpportunityId: opp.id,
        convertedAt: new Date(),
      },
    });

    await prisma.auditLog.create({
      data: {
        orgId: ctx.orgId,
        action: 'lead.convert.mcp',
        targetType: 'lead',
        targetId: lead.id,
        diff: { opportunityId: opp.id, contactId: contact.id },
      },
    });

    return {
      leadId: lead.id,
      opportunityId: opp.id,
      contactId: contact.id,
    };
  },
};

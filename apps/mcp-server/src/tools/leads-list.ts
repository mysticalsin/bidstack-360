import { z } from 'zod';

import {
  prisma,
  type LeadStatus as PrismaLeadStatus,
  type LeadPriority as PrismaLeadPriority,
} from '@bidstack/db';

import type { Tool } from './index.js';

const Input = z.object({
  status: z
    .enum(['new', 'contacted', 'qualified', 'nurture', 'disqualified', 'converted'])
    .optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  source: z
    .enum(['website', 'referral', 'event', 'cold_outreach', 'partner', 'social', 'other'])
    .optional(),
  search: z.string().optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

export const leadsList: Tool<typeof Input> = {
  description: 'List leads matching filters (status/priority/source/search).',
  input: Input,
  inputJsonSchema: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: ['new', 'contacted', 'qualified', 'nurture', 'disqualified', 'converted'],
      },
      priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
      source: {
        type: 'string',
        enum: ['website', 'referral', 'event', 'cold_outreach', 'partner', 'social', 'other'],
      },
      search: { type: 'string' },
      limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
    },
    additionalProperties: false,
  },
  handler: async (args, ctx) => {
    const items = await prisma.lead.findMany({
      where: {
        orgId: ctx.orgId,
        ...(args.status ? { status: args.status as PrismaLeadStatus } : {}),
        ...(args.priority ? { priority: args.priority as PrismaLeadPriority } : {}),
        ...(args.source ? { source: args.source } : {}),
        ...(args.search
          ? {
              OR: [
                { firstName: { contains: args.search, mode: 'insensitive' } },
                { lastName: { contains: args.search, mode: 'insensitive' } },
                { email: { contains: args.search, mode: 'insensitive' } },
                { companyName: { contains: args.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: { owner: true },
      orderBy: { updatedAt: 'desc' },
      take: args.limit,
    });
    return items.map((l) => ({
      id: l.id,
      firstName: l.firstName,
      lastName: l.lastName,
      email: l.email,
      phone: l.phone,
      companyName: l.companyName,
      title: l.title,
      source: l.source,
      status: l.status,
      score: l.score,
      priority: l.priority,
      owner: l.owner?.email ?? null,
      convertedToOpportunityId: l.convertedToOpportunityId,
      createdAt: l.createdAt.toISOString(),
      updatedAt: l.updatedAt.toISOString(),
    }));
  },
};

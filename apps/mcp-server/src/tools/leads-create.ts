import { z } from 'zod';

import {
  prisma,
  type LeadStatus as PrismaLeadStatus,
  type LeadPriority as PrismaLeadPriority,
} from '@bidstack/db';

import type { Tool } from './index.js';

const Input = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  email: z.string().email().optional(),
  phone: z.string().max(50).optional(),
  companyName: z.string().min(1).max(255),
  title: z.string().max(100).optional(),
  source: z
    .enum(['website', 'referral', 'event', 'cold_outreach', 'partner', 'social', 'other'])
    .default('website'),
  priority: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  score: z.number().int().min(0).max(100).default(0),
  ownerEmail: z.string().email().optional(),
  notes: z.string().max(5000).optional(),
  budget: z.string().max(20).optional(),
  authority: z.string().max(20).optional(),
  need: z.string().max(20).optional(),
  timeline: z.string().max(20).optional(),
});

export const leadsCreate: Tool<typeof Input> = {
  description: 'Create a new lead in the CRM with BANT qualification fields.',
  input: Input,
  inputJsonSchema: {
    type: 'object',
    required: ['firstName', 'lastName', 'companyName'],
    properties: {
      firstName: { type: 'string', minLength: 1, maxLength: 100 },
      lastName: { type: 'string', minLength: 1, maxLength: 100 },
      email: { type: 'string', format: 'email' },
      phone: { type: 'string', maxLength: 50 },
      companyName: { type: 'string', minLength: 1, maxLength: 255 },
      title: { type: 'string', maxLength: 100 },
      source: {
        type: 'string',
        enum: ['website', 'referral', 'event', 'cold_outreach', 'partner', 'social', 'other'],
        default: 'website',
      },
      priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'], default: 'medium' },
      score: { type: 'integer', minimum: 0, maximum: 100, default: 0 },
      ownerEmail: { type: 'string', format: 'email' },
      notes: { type: 'string', maxLength: 5000 },
      budget: { type: 'string', maxLength: 20 },
      authority: { type: 'string', maxLength: 20 },
      need: { type: 'string', maxLength: 20 },
      timeline: { type: 'string', maxLength: 20 },
    },
    additionalProperties: false,
  },
  handler: async (args, ctx) => {
    const owner = args.ownerEmail
      ? await prisma.user.findFirst({ where: { orgId: ctx.orgId, email: args.ownerEmail } })
      : null;

    const created = await prisma.lead.create({
      data: {
        orgId: ctx.orgId,
        firstName: args.firstName,
        lastName: args.lastName,
        email: args.email ?? null,
        phone: args.phone ?? null,
        companyName: args.companyName,
        title: args.title ?? null,
        source: args.source,
        status: 'new' as PrismaLeadStatus,
        priority: args.priority as PrismaLeadPriority,
        score: args.score,
        ownerId: owner?.id ?? null,
        notes: args.notes ?? null,
        budget: args.budget ?? null,
        authority: args.authority ?? null,
        need: args.need ?? null,
        timeline: args.timeline ?? null,
        intel: {},
      },
      include: { owner: true },
    });

    await prisma.auditLog.create({
      data: {
        orgId: ctx.orgId,
        action: 'lead.create.mcp',
        targetType: 'lead',
        targetId: created.id,
        diff: { firstName: args.firstName, lastName: args.lastName, companyName: args.companyName },
      },
    });

    return {
      id: created.id,
      firstName: created.firstName,
      lastName: created.lastName,
      email: created.email,
      companyName: created.companyName,
      status: created.status,
      score: created.score,
      priority: created.priority,
      owner: created.owner?.email ?? null,
      createdAt: created.createdAt.toISOString(),
    };
  },
};

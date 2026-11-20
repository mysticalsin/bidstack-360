import { z } from 'zod';

import {
  prisma,
  type LeadStatus as PrismaLeadStatus,
  type LeadPriority as PrismaLeadPriority,
} from '@bidstack/db';

import type { Tool } from './index.js';

const Input = z.object({
  id: z.string().uuid(),
  patch: z.object({
    firstName: z.string().min(1).max(100).optional(),
    lastName: z.string().min(1).max(100).optional(),
    email: z.string().email().optional().nullable(),
    phone: z.string().max(50).optional().nullable(),
    companyName: z.string().min(1).max(255).optional(),
    title: z.string().max(100).optional().nullable(),
    source: z
      .enum(['website', 'referral', 'event', 'cold_outreach', 'partner', 'social', 'other'])
      .optional(),
    status: z
      .enum(['new', 'contacted', 'qualified', 'nurture', 'disqualified', 'converted'])
      .optional(),
    priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
    score: z.number().int().min(0).max(100).optional(),
    ownerEmail: z.string().email().optional().nullable(),
    notes: z.string().max(5000).optional().nullable(),
    budget: z.string().max(20).optional().nullable(),
    authority: z.string().max(20).optional().nullable(),
    need: z.string().max(20).optional().nullable(),
    timeline: z.string().max(20).optional().nullable(),
  }),
});

export const leadsUpdate: Tool<typeof Input> = {
  description: 'Update a lead. Common use: agent changes status, score, or BANT qualification.',
  input: Input,
  inputJsonSchema: {
    type: 'object',
    required: ['id', 'patch'],
    properties: {
      id: { type: 'string', format: 'uuid' },
      patch: {
        type: 'object',
        properties: {
          firstName: { type: 'string', minLength: 1, maxLength: 100 },
          lastName: { type: 'string', minLength: 1, maxLength: 100 },
          email: { type: ['string', 'null'], format: 'email' },
          phone: { type: ['string', 'null'], maxLength: 50 },
          companyName: { type: 'string', minLength: 1, maxLength: 255 },
          title: { type: ['string', 'null'], maxLength: 100 },
          source: {
            type: 'string',
            enum: ['website', 'referral', 'event', 'cold_outreach', 'partner', 'social', 'other'],
          },
          status: {
            type: 'string',
            enum: ['new', 'contacted', 'qualified', 'nurture', 'disqualified', 'converted'],
          },
          priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
          score: { type: 'integer', minimum: 0, maximum: 100 },
          ownerEmail: { type: ['string', 'null'], format: 'email' },
          notes: { type: ['string', 'null'], maxLength: 5000 },
          budget: { type: ['string', 'null'], maxLength: 20 },
          authority: { type: ['string', 'null'], maxLength: 20 },
          need: { type: ['string', 'null'], maxLength: 20 },
          timeline: { type: ['string', 'null'], maxLength: 20 },
        },
        additionalProperties: false,
      },
    },
    additionalProperties: false,
  },
  handler: async (args, ctx) => {
    const before = await prisma.lead.findFirst({
      where: { id: args.id, orgId: ctx.orgId, deletedAt: null }, // skip soft-deleted (Review)
    });
    if (!before) throw new Error('Lead not found');

    const p = args.patch;
    let ownerId: string | null | undefined = undefined;
    if (p.ownerEmail !== undefined) {
      if (p.ownerEmail === null) {
        ownerId = null;
      } else {
        const owner = await prisma.user.findFirst({
          where: { orgId: ctx.orgId, email: p.ownerEmail },
        });
        ownerId = owner?.id ?? null;
      }
    }

    const updated = await prisma.lead.update({
      where: { id: before.id },
      data: {
        ...(p.firstName !== undefined ? { firstName: p.firstName } : {}),
        ...(p.lastName !== undefined ? { lastName: p.lastName } : {}),
        ...(p.email !== undefined ? { email: p.email } : {}),
        ...(p.phone !== undefined ? { phone: p.phone } : {}),
        ...(p.companyName !== undefined ? { companyName: p.companyName } : {}),
        ...(p.title !== undefined ? { title: p.title } : {}),
        ...(p.source !== undefined ? { source: p.source } : {}),
        ...(p.status !== undefined ? { status: p.status as PrismaLeadStatus } : {}),
        ...(p.priority !== undefined ? { priority: p.priority as PrismaLeadPriority } : {}),
        ...(p.score !== undefined ? { score: p.score } : {}),
        ...(ownerId !== undefined ? { ownerId } : {}),
        ...(p.notes !== undefined ? { notes: p.notes } : {}),
        ...(p.budget !== undefined ? { budget: p.budget } : {}),
        ...(p.authority !== undefined ? { authority: p.authority } : {}),
        ...(p.need !== undefined ? { need: p.need } : {}),
        ...(p.timeline !== undefined ? { timeline: p.timeline } : {}),
      },
      include: { owner: true },
    });

    await prisma.auditLog.create({
      data: {
        orgId: ctx.orgId,
        action: 'lead.update.mcp',
        targetType: 'lead',
        targetId: updated.id,
        diff: p,
      },
    });

    return {
      id: updated.id,
      firstName: updated.firstName,
      lastName: updated.lastName,
      email: updated.email,
      companyName: updated.companyName,
      status: updated.status,
      score: updated.score,
      priority: updated.priority,
      owner: updated.owner?.email ?? null,
      updatedAt: updated.updatedAt.toISOString(),
    };
  },
};

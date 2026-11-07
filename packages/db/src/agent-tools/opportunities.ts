import { z } from 'zod';

import { prisma, type OpportunityStage as PrismaStage } from '../index.js';

import { isoDate, oppCitation, type AgentTool } from './types.js';

const Stage = z.enum([
  's1_lead',
  's1_ongoing',
  's2_sent',
  's3_technical_iteration',
  's4_negotiation',
  'closed_won',
  'closed_lost',
]);
const STAGE_OPTIONS = [...Stage.options];

const ListInput = z.object({
  stage: Stage.optional(),
  owner: z.string().email().optional(),
  industry: z.string().optional(),
  search: z.string().optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

export const opportunitiesList: AgentTool<typeof ListInput> = {
  description:
    'List opportunities matching filters (stage/owner/industry/search). currency is null and currencyBasis is unspecified when the row has no currency. probability is win likelihood, not account health.',
  input: ListInput,
  kind: 'read',
  permission: 'opportunities:read',
  inputJsonSchema: {
    type: 'object',
    properties: {
      stage: {
        type: 'string',
        enum: Stage.options,
      },
      owner: { type: 'string', format: 'email' },
      industry: { type: 'string' },
      search: { type: 'string' },
      limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
    },
    additionalProperties: false,
  },
  handler: async (args, ctx) => {
    const items = await prisma.opportunity.findMany({
      where: {
        orgId: ctx.orgId,
        deletedAt: null, // skip soft-deleted (Review)
        ...(args.stage ? { stage: args.stage as PrismaStage } : {}),
        ...(args.industry ? { industry: args.industry } : {}),
        ...(args.owner ? { owner: { email: args.owner } } : {}),
        ...(args.search
          ? {
              OR: [
                { customer: { contains: args.search, mode: 'insensitive' } },
                { name: { contains: args.search, mode: 'insensitive' } },
                { code: { contains: args.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: { owner: true },
      orderBy: { updatedAt: 'desc' },
      take: args.limit,
    });
    return items.map((o) => ({
      id: o.id,
      code: o.code,
      customer: o.customer,
      name: o.name,
      stage: o.stage,
      value: Number(o.valueMicros) / 1_000_000,
      probability: o.probability,
      // Opportunity has no currency column. Do not label the value as EUR.
      currency: null,
      currencyBasis: 'unspecified' as const,
      companyId: o.companyId,
      health: 'not_account_health' as const,
      healthNote: 'Probability is win likelihood for this opportunity, not account health.',
      dueDate: isoDate(o.dueDate),
      owner: o.owner?.email ?? null,
      industry: o.industry,
      updatedAt: o.updatedAt.toISOString(),
    }));
  },
};

const GetInput = z
  .object({
    id: z.string().uuid().optional(),
    code: z
      .string()
      .regex(/^OP-\d{4}$/)
      .optional(),
  })
  .refine((v) => v.id || v.code, { message: 'Provide either id or code' });

export const opportunitiesGet: AgentTool<typeof GetInput> = {
  description:
    'Fetch one opportunity with full intel payload (financials, triggers, decision unit, competitors, news, hiring, win prediction).',
  input: GetInput,
  kind: 'read',
  permission: 'opportunities:read',
  inputJsonSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      code: { type: 'string', pattern: '^OP-\\d{4}$' },
    },
    additionalProperties: false,
  },
  handler: async (args, ctx) => {
    const opp = await prisma.opportunity.findFirst({
      where: {
        orgId: ctx.orgId,
        deletedAt: null, // skip soft-deleted (Review)
        ...(args.id ? { id: args.id } : { code: args.code }),
      },
      include: {
        owner: true,
        tasks: { orderBy: { createdAt: 'desc' }, take: 50 },
        documents: { orderBy: { createdAt: 'desc' }, take: 50 },
      },
    });
    if (!opp) throw new Error('Opportunity not found');
    return {
      id: opp.id,
      code: opp.code,
      customer: opp.customer,
      name: opp.name,
      stage: opp.stage,
      value: Number(opp.valueMicros) / 1_000_000,
      probability: opp.probability,
      dueDate: isoDate(opp.dueDate),
      owner: opp.owner?.email ?? null,
      industry: opp.industry,
      intel: opp.intel,
      tasks: opp.tasks.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        dueDate: isoDate(t.dueDate),
      })),
      documents: opp.documents.map((d) => ({ id: d.id, name: d.name, kind: d.kind })),
      citations: [oppCitation(opp)],
    };
  },
};

const Patch = z.object({
  stage: Stage.optional(),
  probability: z.number().int().min(0).max(100).optional(),
  value: z.number().nonnegative().optional(),
  dueDate: z.string().date().nullable().optional(),
  customer: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  industry: z.string().nullable().optional(),
});

const UpdateInput = z.object({
  id: z.string().uuid(),
  patch: Patch,
});

const PATCH_LABELS: Record<keyof z.infer<typeof Patch>, string> = {
  stage: 'Stage',
  probability: 'Probability',
  value: 'Value',
  dueDate: 'Due date',
  customer: 'Customer',
  name: 'Name',
  industry: 'Industry',
};

async function findOpp(orgId: string, id: string) {
  const opp = await prisma.opportunity.findFirst({
    where: { id, orgId, deletedAt: null }, // skip soft-deleted (Review)
  });
  if (!opp) throw new Error('Opportunity not found');
  return opp;
}

export const opportunityUpdate: AgentTool<typeof UpdateInput> = {
  description:
    'Patch an opportunity. Common use: agent updates stage, probability, or value. Writes audit_log.',
  input: UpdateInput,
  kind: 'write',
  permission: 'opportunities:write',
  inputJsonSchema: {
    type: 'object',
    required: ['id', 'patch'],
    properties: {
      id: { type: 'string', format: 'uuid' },
      patch: {
        type: 'object',
        properties: {
          stage: {
            type: 'string',
            enum: STAGE_OPTIONS,
          },
          probability: { type: 'integer', minimum: 0, maximum: 100 },
          value: { type: 'number', minimum: 0 },
          dueDate: { type: ['string', 'null'], format: 'date' },
          customer: { type: 'string', minLength: 1 },
          name: { type: 'string', minLength: 1 },
          industry: { type: ['string', 'null'] },
        },
        additionalProperties: false,
      },
    },
  },
  preview: async (args, ctx) => {
    const opp = await findOpp(ctx.orgId, args.id);
    const before: Record<string, unknown> = {
      stage: opp.stage,
      probability: opp.probability,
      value: Number(opp.valueMicros) / 1_000_000,
      dueDate: isoDate(opp.dueDate),
      customer: opp.customer,
      name: opp.name,
      industry: opp.industry,
    };
    const changes = (Object.keys(args.patch) as Array<keyof typeof PATCH_LABELS>)
      .filter((key) => args.patch[key] !== undefined)
      .map((key) => ({
        field: PATCH_LABELS[key],
        value: `${String(before[key] ?? 'none')} to ${String(args.patch[key] ?? 'none')}`,
      }));
    return {
      title: `Update ${opp.code}`,
      changes,
      citation: oppCitation(opp),
    };
  },
  handler: async (args, ctx) => {
    const before = await findOpp(ctx.orgId, args.id);

    const { patch } = args;
    const updated = await prisma.opportunity.update({
      where: { id: before.id },
      data: {
        ...(patch.stage ? { stage: patch.stage as PrismaStage } : {}),
        ...(patch.probability !== undefined ? { probability: patch.probability } : {}),
        ...(patch.value !== undefined
          ? { valueMicros: BigInt(Math.round(patch.value * 1_000_000)) }
          : {}),
        ...(patch.dueDate !== undefined
          ? { dueDate: patch.dueDate ? new Date(patch.dueDate) : null }
          : {}),
        ...(patch.customer ? { customer: patch.customer } : {}),
        ...(patch.name ? { name: patch.name } : {}),
        ...(patch.industry !== undefined ? { industry: patch.industry } : {}),
      },
      include: { owner: true },
    });

    await prisma.auditLog.create({
      data: {
        orgId: ctx.orgId,
        userId: ctx.userId ?? null,
        action: ctx.surface === 'jarvis' ? 'opportunity.update.jarvis' : 'opportunity.update.mcp',
        targetType: 'opportunity',
        targetId: updated.id,
        diff: patch,
      },
    });

    return {
      id: updated.id,
      code: updated.code,
      customer: updated.customer,
      name: updated.name,
      stage: updated.stage,
      value: Number(updated.valueMicros) / 1_000_000,
      probability: updated.probability,
      dueDate: isoDate(updated.dueDate),
      owner: updated.owner?.email ?? null,
      industry: updated.industry,
      updatedAt: updated.updatedAt.toISOString(),
    };
  },
};

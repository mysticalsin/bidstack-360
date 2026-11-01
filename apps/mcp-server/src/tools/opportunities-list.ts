import { z } from 'zod';

import { prisma, type OpportunityStage as PrismaStage } from '@bidstack/db';

import type { Tool } from './index.js';
import {
  dealOutcome,
  dealValueMicros,
  dealValueUnits,
  liveStageName,
  outcomeWhere,
  recordedProbability,
  requireCompanyLink,
} from './crm-tools.helpers.js';

const Stage = z.enum([
  's1_lead',
  's1_ongoing',
  's2_sent',
  's3_technical_iteration',
  's4_negotiation',
  'closed_won',
  'closed_lost',
]);

const Outcome = z.enum(['open', 'won', 'lost']);

const Input = z.object({
  stage: Stage.optional(),
  outcome: Outcome.optional(),
  owner: z.string().email().optional(),
  industry: z.string().optional(),
  companyId: z.string().uuid().optional(),
  search: z.string().optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

export const opportunitiesList: Tool<typeof Input> = {
  description:
    'List opportunities. companyId returns deals linked to that company. search matches customer text, name, or code and is not a company link. stage is the stored key and stageName is the live label. A deleted stage falls back to the key. Pass outcome to keep the list to open, won, or lost: a live lost or won flag decides it, and lost wins when both are set. A deleted stage does not close the deal. currency is null and currencyBasis is unspecified when the row has no currency. probability is null when nothing was recorded. A stored 0 is not a measured win chance, and it is not account health.',
  input: Input,
  inputJsonSchema: {
    type: 'object',
    properties: {
      stage: {
        type: 'string',
        enum: Stage.options,
      },
      outcome: {
        type: 'string',
        enum: Outcome.options,
        description: 'open, won, or lost. A live stage flag decides it. Lost wins when both flags are set.',
      },
      owner: { type: 'string', format: 'email' },
      industry: { type: 'string' },
      companyId: { type: 'string', format: 'uuid' },
      search: {
        type: 'string',
        description: 'Text match on customer, name, or code. Not a company link.',
      },
      limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
    },
    additionalProperties: false,
  },
  handler: async (args, ctx) => {
    if (args.companyId) {
      await requireCompanyLink(ctx.orgId, { companyId: args.companyId });
    }
    const filters = [
      ...(args.stage ? [{ stage: args.stage as PrismaStage }] : []),
      ...(args.outcome ? [outcomeWhere(args.outcome)] : []),
      ...(args.industry ? [{ industry: args.industry }] : []),
      ...(args.companyId ? [{ companyId: args.companyId }] : []),
      ...(args.owner ? [{ owner: { email: args.owner } }] : []),
      ...(args.search
        ? [
            {
              OR: [
                { customer: { contains: args.search, mode: 'insensitive' } },
                { name: { contains: args.search, mode: 'insensitive' } },
                { code: { contains: args.search, mode: 'insensitive' } },
              ],
            },
          ]
        : []),
    ];
    const items = await prisma.opportunity.findMany({
      where: {
        orgId: ctx.orgId,
        deletedAt: null, // skip soft-deleted (Review)
        ...(filters.length > 0 ? { AND: filters } : {}),
      },
      include: {
        owner: true,
        pipelineStage: { select: { name: true, isWon: true, isLost: true, deletedAt: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: args.limit,
    });
    return items.map((o) => ({
      id: o.id,
      code: o.code,
      customer: o.customer,
      name: o.name,
      stage: o.stage,
      stageName: liveStageName(o.stage, o.pipelineStage),
      outcome: dealOutcome(o),
      value: dealValueUnits(o.valueMicros),
      valueMicros: dealValueMicros(o.valueMicros),
      probability: recordedProbability(o.probability),
      // Opportunity has no currency column. Do not label the value as EUR.
      currency: null,
      currencyBasis: 'unspecified' as const,
      companyId: o.companyId,
      health: 'not_account_health' as const,
      healthNote: 'Probability is win likelihood for this opportunity, not account health.',
      dueDate: o.dueDate?.toISOString().slice(0, 10) ?? null,
      owner: o.owner?.email ?? null,
      industry: o.industry,
      updatedAt: o.updatedAt.toISOString(),
    }));
  },
};

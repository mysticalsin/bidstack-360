import { z } from 'zod';

import { prisma } from '@bidstack/db';
import { presentOpportunityIntel } from '@bidstack/shared';

import type { Tool } from './index.js';
import { dealOutcome, liveStageName, recordedProbability } from './crm-tools.helpers.js';

const Input = z
  .object({
    id: z.string().uuid().optional(),
    code: z
      .string()
      .regex(/^OP-\d{4}$/)
      .optional(),
  })
  .refine((v) => v.id || v.code, { message: 'Provide either id or code' });

export const opportunitiesGet: Tool<typeof Input> = {
  description:
    'Fetch one opportunity. companyId is the company link. stage is the stored key and stageName is the live label. A deleted stage falls back to the key. outcome is open, won, or lost; a live lost or won flag decides it, and lost wins when both are set. currency is null and currencyBasis is unspecified. probability is null when nothing was recorded. A stored 0 is not a measured win chance, and it is not account health.',
  input: Input,
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
        pipelineStage: { select: { name: true, isWon: true, isLost: true, deletedAt: true } },
        tasks: { orderBy: { createdAt: 'desc' }, take: 50 },
        documents: { orderBy: { createdAt: 'desc' }, take: 50 },
      },
    });
    if (!opp) throw new Error('Opportunity not found');
    return {
      id: opp.id,
      code: opp.code,
      customer: opp.customer,
      companyId: opp.companyId,
      name: opp.name,
      stage: opp.stage,
      stageName: liveStageName(opp.stage, opp.pipelineStage),
      outcome: dealOutcome(opp),
      value: Number(opp.valueMicros) / 1_000_000,
      currency: null,
      currencyBasis: 'unspecified' as const,
      health: 'not_account_health' as const,
      healthNote: 'Probability is win likelihood for this opportunity, not account health.',
      probability: recordedProbability(opp.probability),
      dueDate: opp.dueDate?.toISOString().slice(0, 10) ?? null,
      owner: opp.owner?.email ?? null,
      industry: opp.industry,
      intel: presentOpportunityIntel(opp.intel),
      tasks: opp.tasks.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        dueDate: t.dueDate?.toISOString().slice(0, 10) ?? null,
      })),
      documents: opp.documents.map((d) => ({ id: d.id, name: d.name, kind: d.kind })),
    };
  },
};

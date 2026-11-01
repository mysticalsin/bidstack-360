import { z } from 'zod';

import { prisma, type OpportunityStage as PrismaStage } from '@bidstack/db';

import type { Tool } from './index.js';
import {
  companyIdForCustomerRename,
  dealOutcome,
  dealValueUnits,
  pipelineStageIdForStageChange,
  recordedProbability,
  recordOpportunityStageMove,
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
const STAGE_OPTIONS = [...Stage.options];

const Patch = z.object({
  stage: Stage.optional(),
  probability: z.number().int().min(0).max(100).optional(),
  value: z.number().nonnegative().optional(),
  dueDate: z.string().date().nullable().optional(),
  customer: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  industry: z.string().nullable().optional(),
});

const Input = z.object({
  id: z.string().uuid(),
  patch: Patch,
});

export const opportunityUpdate: Tool<typeof Input> = {
  description:
    'Patch an opportunity. Changing customer relinks when that name matches one company, clears the link when it matches none, and refuses when it matches several. A stage change links the one live pipeline stage with the new key, or clears that link when none exists. Two matches are refused and the deal stays put. Repeating the current stage does not. The result outcome is open, won, or lost from the stored key and any live stage flag. Other fields do not touch the link. Writes audit_log.',
  input: Input,
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
  handler: async (args, ctx) => {
    const before = await prisma.opportunity.findFirst({
      where: { id: args.id, orgId: ctx.orgId, deletedAt: null }, // skip soft-deleted (Review)
    });
    if (!before) throw new Error('Opportunity not found');

    const { patch } = args;
    const companyId =
      patch.customer !== undefined && patch.customer !== before.customer
        ? await companyIdForCustomerRename(ctx.orgId, patch.customer)
        : undefined;
    const pipelineStageId = await pipelineStageIdForStageChange(ctx.orgId, before.stage, patch.stage);
    const updated = await prisma.opportunity.update({
      where: { id: before.id },
      data: {
        ...(patch.stage ? { stage: patch.stage as PrismaStage } : {}),
        ...(pipelineStageId !== undefined ? { pipelineStageId } : {}),
        ...(patch.probability !== undefined ? { probability: patch.probability } : {}),
        ...(patch.value !== undefined
          ? { valueMicros: BigInt(Math.round(patch.value * 1_000_000)) }
          : {}),
        ...(patch.dueDate !== undefined
          ? { dueDate: patch.dueDate ? new Date(patch.dueDate) : null }
          : {}),
        ...(patch.customer ? { customer: patch.customer } : {}),
        ...(companyId !== undefined ? { companyId } : {}),
        ...(patch.name ? { name: patch.name } : {}),
        ...(patch.industry !== undefined ? { industry: patch.industry } : {}),
      },
      include: {
        owner: true,
        pipelineStage: { select: { isWon: true, isLost: true, deletedAt: true } },
      },
    });

    await prisma.auditLog.create({
      data: {
        orgId: ctx.orgId,
        action: 'opportunity.update.mcp',
        targetType: 'opportunity',
        targetId: updated.id,
        diff: patch,
      },
    });
    await recordOpportunityStageMove(ctx.orgId, before, patch.stage);

    return {
      id: updated.id,
      code: updated.code,
      customer: updated.customer,
      name: updated.name,
      stage: updated.stage,
      outcome: dealOutcome(updated),
      value: dealValueUnits(updated.valueMicros),
      probability: recordedProbability(updated.probability),
      dueDate: updated.dueDate?.toISOString().slice(0, 10) ?? null,
      owner: updated.owner?.email ?? null,
      industry: updated.industry,
      companyId: updated.companyId,
      updatedAt: updated.updatedAt.toISOString(),
    };
  },
};

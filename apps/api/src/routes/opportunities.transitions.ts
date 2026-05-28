/**
 * opportunities.transitions.ts — Stage transition and AI brief sub-plugin.
 *
 * WHY separate: POST /opportunities/:id/stage and POST /opportunities/:id/brief
 * are workflow-action routes that mutate existing opportunities through state
 * transitions, not CRUD operations. They share pushOpportunityToDust /
 * fanOutWebhookEvent but have no overlap with the create/import or read/patch
 * handlers. Isolating them here keeps every file under the 400-line cap.
 *
 * Import DAG: no local sibling imports — leaf node relative to helpers.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma, type OpportunityStage as PrismaStage } from '@bidstack/db';
import { pushOpportunityToDust } from '../lib/dust-push.js';
import { fanOutWebhookEvent } from '../queues/webhook-delivery.js';

export const opportunityTransitionRoutes: FastifyPluginAsyncZod = async (server) => {
  // POST /api/opportunities/:id/stage  (kanban move)
  server.post(
    '/opportunities/:id/stage',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z
          .object({
            pipelineStageId: z.string().uuid().optional(),
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
          })
          .refine((body) => body.pipelineStageId || body.stage, {
            message: 'pipelineStageId or stage is required',
          }),
        response: {
          200: z.object({
            id: z.string().uuid(),
            pipelineStageId: z.string().uuid().nullable(),
            stage: z.string(),
          }),
        },
      },
    },
    async (req) => {
      const opp = await prisma.opportunity.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
      });
      if (!opp) throw server.httpErrors.notFound('Opportunity not found');

      const requestedStage = req.body.stage as PrismaStage | undefined;
      const toStage = await prisma.pipelineStage.findFirst({
        where: {
          orgId: req.auth.orgId,
          deletedAt: null,
          ...(req.body.pipelineStageId
            ? { id: req.body.pipelineStageId }
            : { key: requestedStage }),
        },
      });
      if (!toStage && req.body.pipelineStageId) {
        throw server.httpErrors.badRequest('Invalid pipeline stage');
      }
      const nextStage = (toStage?.key ?? requestedStage) as PrismaStage | undefined;
      if (!nextStage) throw server.httpErrors.badRequest('Invalid pipeline stage');

      // Any stage can move to any stage within the same pipeline for now.
      const [updated] = await prisma.$transaction([
        prisma.opportunity.update({
          where: { id: opp.id },
          data: { pipelineStageId: toStage?.id ?? null, stage: nextStage },
        }),
        prisma.auditLog.create({
          data: {
            orgId: req.auth.orgId,
            userId: req.auth.userId,
            action: 'opportunity.stage',
            targetType: 'opportunity',
            targetId: opp.id,
            diff: {
              fromPipelineStageId: opp.pipelineStageId,
              toPipelineStageId: toStage?.id ?? null,
              fromStage: opp.stage,
              toStage: nextStage,
            },
          },
        }),
      ]);
      // Fire-and-forget push to Dust on stage change.
      void pushOpportunityToDust(updated.id, req.auth.orgId);
      // Fan-out webhook event for stage change.
      void fanOutWebhookEvent(req.auth.orgId, 'opportunity.stage_changed', {
        id: updated.id,
        pipelineStageId: updated.pipelineStageId,
        stage: nextStage,
        stageName: toStage?.name ?? nextStage,
      });
      return {
        id: updated.id,
        pipelineStageId: updated.pipelineStageId,
        stage: nextStage,
      };
    },
  );

  // POST /api/opportunities/:id/brief
  // Stubbed: returns a deterministic markdown brief in dev.
  // Production will call Dust agent then Anthropic fallback per openapi.yaml.
  server.post(
    '/opportunities/:id/brief',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: {
          200: z.object({
            brief: z.string(),
            model: z.string(),
            tokens: z.number().int(),
          }),
        },
      },
    },
    async (req) => {
      const opp = await prisma.opportunity.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
        include: { pipelineStage: { select: { name: true } } },
      });
      if (!opp) throw server.httpErrors.notFound('Opportunity not found');

      const brief = `# Exec brief — ${opp.customer}

**Opportunity:** ${opp.name} (${opp.code})
**Stage:** ${opp.pipelineStage?.name ?? opp.stage}  ·  **Value:** €${(Number(opp.valueMicros) / 1_000_000).toString()}  ·  **Probability:** ${opp.probability}%

> Stub brief generated locally. Set \`DUST_API_KEY\` and \`DUST_AGENT_EXEC_BRIEF\` to enable the live agent path.
`;
      return { brief, model: 'stub-local', tokens: brief.length };
    },
  );
};

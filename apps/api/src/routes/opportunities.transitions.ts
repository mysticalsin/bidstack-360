/**
 * opportunities.transitions.ts - Stage transition and account brief sub-plugin.
 *
 * POST /opportunities/:id/stage and POST /opportunities/:id/brief are
 * workflow-action routes around an existing opportunity. They share Dust and
 * webhook fan-out but have no overlap with create/import/read/patch handlers.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma, type OpportunityStage as PrismaStage } from '@bidstack/db';
import {
  isLegalStageTransition,
  isForwardMove,
  resolveStandingDecision,
  type StageNode,
} from '@bidstack/shared';
import { config } from '../env.js';
import { pushOpportunityToDust } from '../lib/dust-push.js';
import { fanOutWebhookEvent } from '../queues/webhook-delivery.js';
import { dispatchWorkflowEvent } from '../queues/workflow-dispatch.js';
import { createNotification } from '../services/notification.service.js';
import { buildOpportunityBrief, estimateBriefTokens } from './opportunities.brief.js';

export const opportunityTransitionRoutes: FastifyPluginAsyncZod = async (server) => {
  // RBAC: stage transitions and brief generation mutate opportunity state —
  // require opportunities:write (every route here is a POST).
  server.addHook('preHandler', async (req) => {
    if (req.method !== 'GET') await server.requirePermission('opportunities:write')(req);
  });

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
            pipelineStage: z
              .object({
                id: z.string().uuid(),
                name: z.string(),
                probability: z.number(),
                color: z.string().nullable(),
                isWon: z.boolean(),
                isLost: z.boolean(),
              })
              .nullable(),
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
          archived: false,
          deletedAt: null,
          pipeline: {
            is: {
              orgId: req.auth.orgId,
              archived: false,
              deletedAt: null,
              ...(req.body.pipelineStageId ? {} : { isDefault: true }),
            },
          },
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

      // ── Amaris stage-gate enforcement (STAGE_GATE_MODE) ──────────────────
      // Off by default. Two rules: (1) no illegal stage jumps — only one step,
      // close, or reopen; (2) no forward advancement of a bid with an on-record
      // no-bid/no-go. 'warn' logs, 'enforce' rejects (409). Fail-open on any
      // missing data so a config gap can never wedge the pipeline.
      if (config.STAGE_GATE_MODE !== 'off' && toStage) {
        const stages = await prisma.pipelineStage.findMany({
          where: { pipelineId: toStage.pipelineId, deletedAt: null },
          select: { id: true, orderIndex: true, isWon: true, isLost: true, key: true },
        });
        const nodes: StageNode[] = stages.map((s) => ({
          id: s.id,
          orderIndex: s.orderIndex,
          isWon: s.isWon,
          isLost: s.isLost,
        }));
        const toNode = nodes.find((n) => n.id === toStage.id) ?? null;
        const fromByKey = stages.find((s) => s.key === opp.stage);
        const fromNode =
          nodes.find((n) => n.id === opp.pipelineStageId) ??
          (fromByKey ? (nodes.find((n) => n.id === fromByKey.id) ?? null) : null);

        if (toNode) {
          const violations: string[] = [];
          if (!isLegalStageTransition(fromNode, toNode, nodes)) {
            violations.push('illegal stage jump (only one step, close, or reopen allowed)');
          }
          if (isForwardMove(fromNode, toNode, nodes)) {
            const [latestGate, latestBidScore] = await Promise.all([
              prisma.gateDecision.findFirst({
                where: {
                  orgId: req.auth.orgId,
                  opportunityId: opp.id,
                  gate: { in: ['go_no_go', 'bid_no_bid'] },
                },
                orderBy: { decidedAt: 'desc' },
                select: { gate: true, outcome: true, decidedAt: true },
              }),
              prisma.bidScore.findFirst({
                where: { orgId: req.auth.orgId, opportunityId: opp.id, deletedAt: null },
                orderBy: { createdAt: 'desc' },
                select: { recommendation: true, overrideJustification: true, createdAt: true },
              }),
            ]);
            if (resolveStandingDecision({ latestGate, latestBidScore }) === 'negative') {
              violations.push(
                'cannot advance a no-bid/no-go opportunity — record a positive Go/No-Go or override first',
              );
            }
          }
          if (violations.length > 0) {
            const msg = `Stage gate: ${violations.join('; ')}`;
            if (config.STAGE_GATE_MODE === 'enforce') {
              throw server.httpErrors.conflict(msg);
            }
            req.log.warn(
              { opportunityId: opp.id, fromStage: opp.stage, toStage: nextStage, violations },
              'stage-gate violation (warn mode)',
            );
          }
        }
      }

      // Re-assert the precondition in the WRITE: the opp was read with findFirst
      // above (no lock), so a concurrent move could change its stage between
      // read and write. updateMany guards on the stage/pipelineStageId we saw;
      // count === 0 means someone else moved it first → 409 (lost update).
      const updated = await prisma.$transaction(async (tx) => {
        const { count } = await tx.opportunity.updateMany({
          where: {
            id: opp.id,
            orgId: req.auth.orgId,
            deletedAt: null,
            stage: opp.stage,
            pipelineStageId: opp.pipelineStageId,
          },
          data: { pipelineStageId: toStage?.id ?? null, stage: nextStage },
        });
        if (count === 0) {
          throw server.httpErrors.conflict(
            'Opportunity stage changed concurrently; reload and retry.',
          );
        }
        await tx.auditLog.create({
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
        });
        return tx.opportunity.findFirstOrThrow({
          where: { id: opp.id, orgId: req.auth.orgId },
          include: {
            pipelineStage: {
              select: {
                id: true,
                name: true,
                probability: true,
                color: true,
                isWon: true,
                isLost: true,
              },
            },
          },
        });
      });

      void pushOpportunityToDust(updated.id, req.auth.orgId);
      void fanOutWebhookEvent(req.auth.orgId, 'opportunity.stage_changed', {
        id: updated.id,
        pipelineStageId: updated.pipelineStageId,
        stage: nextStage,
        stageName: toStage?.name ?? nextStage,
      });
      // Dispatch stage_changed workflows for this opportunity (fail-open). The
      // `stage` key drives the optional target-stage condition match; `ownerId`
      // lets "notify the owner" actions resolve the recipient (engine falls back
      // to input.ownerId when create_notification has no explicit userId).
      void dispatchWorkflowEvent(req.auth.orgId, 'stage_changed', 'opportunity', updated.id, {
        stage: nextStage,
        pipelineStageId: updated.pipelineStageId,
        stageName: toStage?.name ?? nextStage,
        ownerId: updated.ownerId,
      });

      // Notify the owner on a real stage change made by someone else — this is
      // the actual kanban-move surface, so it's the primary place deadline-
      // discipline stage-change alerts need to fire. Awaited (not void) so the
      // write is durable before the response returns, but failure is swallowed
      // so a notification hiccup can never fail an otherwise-successful move.
      const stageChanged = opp.stage !== nextStage || opp.pipelineStageId !== updated.pipelineStageId;
      if (stageChanged && updated.ownerId && updated.ownerId !== req.auth.userId) {
        await createNotification({
          orgId: req.auth.orgId,
          userId: updated.ownerId,
          type: 'stage_change',
          title: `${updated.name} moved to ${toStage?.name ?? nextStage}`,
          body: `${updated.customer} — now in ${toStage?.name ?? nextStage}`,
          entityType: 'opportunity',
          entityId: updated.id,
          url: `/opportunities/${updated.id}`,
        }).catch((err: unknown) => {
          req.log.warn({ err, opportunityId: updated.id }, 'stage-change notification failed');
        });
      }

      return {
        id: updated.id,
        pipelineStageId: updated.pipelineStageId,
        stage: nextStage,
        pipelineStage: updated.pipelineStage
          ? {
              ...updated.pipelineStage,
              probability: Number(updated.pipelineStage.probability),
            }
          : null,
      };
    },
  );

  // POST /api/opportunities/:id/brief
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

      const contactFilters = [
        { customer: opp.customer },
        ...(opp.companyId ? [{ companyId: opp.companyId }] : []),
      ];
      const noteFilters = [
        { accountId: opp.customer },
        ...(opp.companyId ? [{ companyId: opp.companyId }] : []),
      ];
      const [tasks, contacts, notes] = await Promise.all([
        prisma.task.findMany({
          where: { orgId: req.auth.orgId, oppId: opp.id, deletedAt: null },
          orderBy: [{ status: 'asc' }, { dueDate: 'asc' }, { createdAt: 'desc' }],
          take: 8,
          select: { title: true, status: true, dueDate: true },
        }),
        prisma.contact.findMany({
          where: { orgId: req.auth.orgId, deletedAt: null, OR: contactFilters },
          orderBy: { createdAt: 'desc' },
          take: 8,
          select: {
            name: true,
            role: true,
            influence: true,
            sentiment: true,
            aiOptOut: true,
          },
        }),
        prisma.note.findMany({
          where: { orgId: req.auth.orgId, deletedAt: null, OR: noteFilters },
          orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
          take: 5,
          select: { title: true, bodyMd: true, pinned: true, updatedAt: true },
        }),
      ]);

      const brief = buildOpportunityBrief({
        opportunity: {
          code: opp.code,
          customer: opp.customer,
          name: opp.name,
          stage: opp.stage,
          pipelineStageName: opp.pipelineStage?.name ?? null,
          valueMicros: opp.valueMicros,
          probability: opp.probability,
          dueDate: opp.dueDate,
          industry: opp.industry,
          updatedAt: opp.updatedAt,
        },
        tasks,
        contacts,
        notes,
      });

      return { brief, model: 'crm-grounded-v1', tokens: estimateBriefTokens(brief) };
    },
  );
};

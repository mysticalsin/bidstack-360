// Opportunity CRUD routes per handoff/openapi.yaml.
// All queries scoped by req.auth.orgId.
//
// POST create + import  → opportunityMutationsRoutes sub-plugin
// POST stage + brief    → opportunityTransitionRoutes sub-plugin

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma, type Prisma, type OpportunityStage as PrismaStage } from '@bidstack/db';
import { pushOpportunityToDust } from '../lib/dust-push.js';
import {
  Opportunity,
  OpportunityFilter,
  OpportunityFull,
  OpportunityPage,
  OpportunityPatch,
} from '@bidstack/shared';

import { serializeOpportunity, serializeOpportunityFull } from '../serializers/opportunity.js';
import { opportunityExportRoutes } from './opportunities.export.js';
import { opportunityMutationsRoutes } from './opportunities.mutations.js';
import { opportunityTransitionRoutes } from './opportunities.transitions.js';

export const opportunityRoutes: FastifyPluginAsyncZod = async (server) => {
  // GET /api/opportunities
  server.get(
    '/opportunities',
    {
      schema: {
        querystring: OpportunityFilter,
        response: { 200: OpportunityPage },
      },
    },
    async (req) => {
      const { pipelineStageId, stage, owner, industry, search, cursor, limit } = req.query;
      return req.cache(
        async () => {
          const items = await prisma.opportunity.findMany({
            where: {
              orgId: req.auth.orgId,
              deletedAt: null,
              ...(pipelineStageId ? { pipelineStageId } : {}),
              ...(stage ? { stage } : {}),
              ...(industry ? { industry } : {}),
              ...(owner ? { owner: { email: owner } } : {}),
              ...(search
                ? {
                    OR: [
                      { customer: { contains: search, mode: 'insensitive' } },
                      { name: { contains: search, mode: 'insensitive' } },
                      { code: { contains: search, mode: 'insensitive' } },
                    ],
                  }
                : {}),
            },
            include: {
              owner: { select: { id: true, name: true, email: true } },
              territory: { select: { name: true } },
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
              _count: { select: { tasks: true } },
            },
            orderBy: { updatedAt: 'desc' },
            take: limit + 1,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          });
          const hasMore = items.length > limit;
          const page = hasMore ? items.slice(0, limit) : items;
          // Batch-fetch comment counts for the page.
          const commentCounts =
            page.length > 0
              ? await prisma.comment.groupBy({
                  by: ['targetId'],
                  where: {
                    orgId: req.auth.orgId,
                    targetType: 'opportunity',
                    targetId: { in: page.map((o) => o.id) },
                    deletedAt: null,
                  },
                  _count: { targetId: true },
                })
              : [];
          const commentCountById = new Map(
            commentCounts.map((c) => [c.targetId, c._count.targetId]),
          );
          return {
            items: page.map((o) =>
              serializeOpportunity(o, {
                taskCount: o._count.tasks,
                commentCount: commentCountById.get(o.id) ?? 0,
              }),
            ),
            nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
          };
        },
        { ttlSeconds: 20, tags: ['opportunities-list'] },
      );
    },
  );

  // GET /api/opportunities/count — lightweight count for badges / KPIs
  server.get(
    '/opportunities/count',
    {
      schema: {
        querystring: z.object({
          pipelineStageId: z.string().uuid().optional(),
          excludeClosed: z.coerce.boolean().optional(),
        }),
        response: { 200: z.object({ count: z.number().int() }) },
      },
    },
    async (req) => {
      const { pipelineStageId, excludeClosed } = req.query;
      return req.cache(
        async () => {
          const count = await prisma.opportunity.count({
            where: {
              orgId: req.auth.orgId,
              deletedAt: null,
              ...(pipelineStageId ? { pipelineStageId } : {}),
              ...(excludeClosed
                ? { stage: { notIn: ['closed_won', 'closed_lost'] as PrismaStage[] } }
                : {}),
            },
          });
          return { count };
        },
        { ttlSeconds: 20, tags: ['opportunities-count'] },
      );
    },
  );

  // GET /api/opportunities/:id  (full 360° payload)
  server.get(
    '/opportunities/:id',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: OpportunityFull },
      },
    },
    async (req) => {
      const opp = await prisma.opportunity.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
        include: {
          // BS-25: narrow owner select — see fix at /opportunities create.
          owner: { select: { id: true, name: true, email: true } },
          territory: { select: { name: true } },
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
          tasks: { orderBy: { createdAt: 'desc' }, take: 50 },
          documents: { orderBy: { createdAt: 'desc' }, take: 50 },
        },
      });
      if (!opp) throw server.httpErrors.notFound('Opportunity not found');
      // View counts are telemetry, not part of the read contract. Keep the
      // detail page fast; a failed counter bump must not turn a valid read into
      // a 500.
      void prisma.opportunity.updateMany({
        where: { id: opp.id, orgId: req.auth.orgId },
        data: { viewCount: { increment: 1 } },
      }).catch((err: unknown) => {
        req.log.warn({ err, opportunityId: opp.id }, 'Failed to update opportunity view count');
      });
      const customFieldValues = await prisma.customFieldValue.findMany({
        where: { orgId: req.auth.orgId, entityType: 'opportunity', entityId: opp.id },
        select: { id: true, definitionId: true, value: true },
        take: 100,
      });
      return { ...serializeOpportunityFull(opp), customFieldValues };
    },
  );

  // PATCH /api/opportunities/:id
  server.patch(
    '/opportunities/:id',
    {
      preHandler: [server.requirePermission('opportunities:write')],
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: OpportunityPatch,
        response: { 200: Opportunity },
      },
    },
    async (req) => {
      const before = await prisma.opportunity.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
      });
      if (!before) throw server.httpErrors.notFound('Opportunity not found');

      // Update + audit atomic so a crash mid-mutation can't leave an opp
      // changed without a paper trail (Arch-4).
      // WHY: territory and owner lookups are independent — run them in parallel
      // to halve round-trips when both fields are present in a single PATCH.
      const needsOwnerLookup = req.body.owner !== undefined && req.body.owner !== null;
      const needsTerritoryLookup =
        req.body.territoryId === undefined &&
        req.body.country !== undefined &&
        req.body.country !== before.country;
      const [patchOwner, patchTerritory] = await Promise.all([
        needsOwnerLookup
          ? prisma.user.findFirst({
              where: { email: req.body.owner as string, orgId: req.auth.orgId },
              select: { id: true },
            })
          : Promise.resolve(null),
        needsTerritoryLookup
          ? prisma.territory.findFirst({
              where: {
                orgId: req.auth.orgId,
                active: true,
                countryCodes: { has: req.body.country as string },
              },
              select: { id: true },
            })
          : Promise.resolve(null),
      ]);

      // Resolve territory
      let territoryId: string | null | undefined = req.body.territoryId;
      if (needsTerritoryLookup) {
        territoryId = patchTerritory?.id ?? null;
      }

      // Resolve owner — eagerly fail if the email doesn't exist in the org
      let resolvedOwnerId: string | null | undefined = undefined;
      if (needsOwnerLookup) {
        if (!patchOwner) throw server.httpErrors.badRequest('Owner user not found');
        resolvedOwnerId = patchOwner.id;
      } else if (req.body.owner === null) {
        resolvedOwnerId = null;
      }

      // Resolve pipeline stage change — validate and sync legacy enum.
      let stageUpdate: PrismaStage | undefined;
      if (req.body.pipelineStageId !== undefined) {
        if (req.body.pipelineStageId === null) {
          // Unsetting pipeline stage is allowed; legacy stage may still be
          // supplied by older clients that have not migrated to PipelineStage.
          if (req.body.stage !== undefined && req.body.stage !== null) {
            stageUpdate = req.body.stage as PrismaStage;
          }
        } else {
          const ps = await prisma.pipelineStage.findFirst({
            where: {
              id: req.body.pipelineStageId,
              orgId: req.auth.orgId,
              archived: false,
              deletedAt: null,
              pipeline: {
                is: {
                  orgId: req.auth.orgId,
                  archived: false,
                  deletedAt: null,
                },
              },
            },
            select: { key: true },
          });
          if (!ps) throw server.httpErrors.badRequest('Invalid pipeline stage');
          stageUpdate = ps.key as PrismaStage;
        }
      } else if (req.body.stage !== undefined && req.body.stage !== null) {
        stageUpdate = req.body.stage as PrismaStage;
      }

      // CF upserts included in the same transaction so a CF failure rolls back
      // the opportunity update — prevents partial-update / data corruption (P0 #5).
      const cfOps = (req.body.customFieldValues ?? []).map(({ definitionId, value }) =>
        prisma.customFieldValue.upsert({
          where: {
            orgId_entityType_entityId_definitionId: {
              orgId: req.auth.orgId,
              entityType: 'opportunity',
              entityId: before.id,
              definitionId,
            },
          },
          update: { value: value as Prisma.InputJsonValue },
          create: {
            orgId: req.auth.orgId,
            definitionId,
            entityType: 'opportunity',
            entityId: before.id,
            value: value as Prisma.InputJsonValue,
          },
        }),
      );

      const [updated] = await prisma.$transaction([
        prisma.opportunity.update({
          where: { id: before.id },
          data: {
            ...(req.body.customer ? { customer: req.body.customer } : {}),
            ...(req.body.name ? { name: req.body.name } : {}),
            ...(stageUpdate ? { stage: stageUpdate } : {}),
            ...(req.body.pipelineStageId !== undefined
              ? { pipelineStageId: req.body.pipelineStageId }
              : {}),
            ...(req.body.value !== undefined
              ? { valueMicros: BigInt(Math.round(req.body.value * 1_000_000)) }
              : {}),
            ...(req.body.probability !== undefined ? { probability: req.body.probability } : {}),
            ...(req.body.dueDate !== undefined
              ? { dueDate: req.body.dueDate ? new Date(req.body.dueDate) : null }
              : {}),
            ...(req.body.industry !== undefined ? { industry: req.body.industry } : {}),
            ...(req.body.logo !== undefined ? { logoUrl: req.body.logo } : {}),
            ...(req.body.country !== undefined ? { country: req.body.country } : {}),
            ...(territoryId !== undefined ? { territoryId } : {}),
            ...(resolvedOwnerId !== undefined ? { ownerId: resolvedOwnerId } : {}),
          },
          // BS-25: narrow owner select — see fix at /opportunities create.
          include: {
            owner: { select: { id: true, name: true, email: true } },
            territory: { select: { name: true } },
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
        }),
        prisma.auditLog.create({
          data: {
            orgId: req.auth.orgId,
            userId: req.auth.userId,
            action: 'opportunity.update',
            targetType: 'opportunity',
            targetId: before.id,
            diff: req.body as object,
          },
        }),
        ...cfOps,
      ]);

      // Fire-and-forget push to Dust on any field update.
      void pushOpportunityToDust(updated.id, req.auth.orgId);

      return serializeOpportunity(updated);
    },
  );

  // DELETE /api/opportunities/:id  (audit P-H5: bulk delete in OpportunitiesPage
  // was hitting this missing route and silently 404'ing every row.)
  server.delete(
    '/opportunities/:id',
    {
      preHandler: [server.requirePermission('opportunities:write')],
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 204: z.null() },
      },
    },
    async (req, reply) => {
      const opp = await prisma.opportunity.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
        select: { id: true, code: true, customer: true, name: true, pipelineStageId: true },
      });
      if (!opp) throw server.httpErrors.notFound('Opportunity not found');

      // Tombstone in audit log first, then delete. Wrap in $transaction so
      // either both land or neither does — never delete-without-record.
      // Cascading FKs on Task / Document delete with the parent (Prisma onDelete: Cascade).
      await prisma.$transaction([
        prisma.auditLog.create({
          data: {
            orgId: req.auth.orgId,
            userId: req.auth.userId,
            action: 'opportunity.delete',
            targetType: 'opportunity',
            targetId: opp.id,
            diff: {
              code: opp.code,
              customer: opp.customer,
              name: opp.name,
              pipelineStageId: opp.pipelineStageId,
            },
          },
        }),
        prisma.opportunity.update({ where: { id: opp.id }, data: { deletedAt: new Date() } }),
      ]);

      return reply.code(204).send(null);
    },
  );

  // Export (streaming CSV), mutations (POST create + import), and transitions sub-plugins.
  // Export MUST be registered before the /:id generic route to prevent "export"
  // being captured as a UUID param.
  await server.register(opportunityExportRoutes);
  await server.register(opportunityMutationsRoutes);
  await server.register(opportunityTransitionRoutes);
};

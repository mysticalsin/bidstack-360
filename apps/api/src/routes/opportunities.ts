// Opportunity CRUD routes per handoff/openapi.yaml.
// All queries scoped by req.auth.orgId.
//
// POST create + import  → opportunityMutationsRoutes sub-plugin
// POST stage + brief    → opportunityTransitionRoutes sub-plugin

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma, type Prisma, type OpportunityStage as PrismaStage } from '@bidstack/db';
import { pushOpportunityToDust } from '../lib/dust-push.js';
import { createNotification } from '../services/notification.service.js';
import {
  Opportunity,
  OpportunityFilter,
  OpportunityFull,
  OpportunityPage,
  OpportunityPatch,
} from '@bidstack/shared';

import {
  applyOpportunityScope,
  getAccessScope,
  scopeCacheTag,
} from '../lib/access-scope.js';
import { augmentTriggersWithSillage, sillageIsConfigured } from '../lib/sillage-intel-augment.js';
import { serializeOpportunity, serializeOpportunityFull } from '../serializers/opportunity.js';
import { resolveCompanyIdByName } from './opportunities.helpers.js';
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
      const { pipelineStageId, stage, owner, industry, search, cursor, limit, dueWithinDays, overdue } =
        req.query;
      // M7 access scoping: group-restricted users only see opportunities in
      // their countries (or that they own). See lib/access-scope.ts.
      const accessScope = await getAccessScope(req.auth.orgId, req.auth.userId);
      // A1 (bid clock): dueDate is a Postgres `date` (midnight UTC) — window on
      // the UTC day boundary so "due within 7 days" agrees with the DueDateChip
      // and bid-deadline-alerts worker regardless of the request's local zone.
      // See apps/worker/src/queues/bid-deadline-alerts.helpers.ts's daysUntilDue.
      const now = new Date();
      const startOfTodayUTC = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
      );
      const dueDateFilter: Prisma.OpportunityWhereInput['dueDate'] | undefined =
        dueWithinDays !== undefined
          ? {
              gte: startOfTodayUTC,
              lte: new Date(startOfTodayUTC.getTime() + dueWithinDays * 86_400_000),
            }
          : overdue
            ? { lt: startOfTodayUTC }
            : undefined;
      return req.cache(
        async () => {
          const items = await prisma.opportunity.findMany({
            where: applyOpportunityScope(
              {
                orgId: req.auth.orgId,
                deletedAt: null,
                ...(pipelineStageId ? { pipelineStageId } : {}),
                ...(stage ? { stage } : {}),
                ...(industry ? { industry } : {}),
                ...(owner ? { owner: { email: owner } } : {}),
                ...(dueDateFilter ? { dueDate: dueDateFilter } : {}),
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
              accessScope,
            ),
            // Explicit select (not include) so the large `intel` JSONB column
            // is NOT fetched for every list row — the list serializer never
            // returns it (only the detail endpoint does).
            select: {
              id: true,
              code: true,
              customer: true,
              name: true,
              stage: true,
              pipelineStageId: true,
              valueMicros: true,
              probability: true,
              dueDate: true,
              industry: true,
              logoUrl: true,
              country: true,
              territoryId: true,
              updatedAt: true,
              viewCount: true,
              bidClass: true,
              // Two scalars, no JSONB: the governance panel needs the inputs the
              // class was derived from, or it reopens on its own defaults and
              // shows a different class than the one on record.
              fteEstimate: true,
              commitmentLevel: true,
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
            // When a due-date window is requested, order by soonest-due-first
            // (or oldest-overdue-first) instead of updatedAt — otherwise a
            // page cap could clip the single most-urgent bid off the
            // "Closing this week" strip / quick-filter chips, which is
            // exactly the missed-deadline failure mode A1 exists to prevent.
            // Compound `id` tiebreaker: `dueDate`/`updatedAt` are non-unique, so
            // a bare single-column cursor silently drops rows when tied values
            // straddle a page boundary (Prisma can't tell "already returned"
            // from "not yet" among equal sort keys). The unique `id` makes the
            // sort total, matching companies.ts/tasks.ts/activities.ts. Tiebreaker
            // direction follows the primary sort so the cursor walks monotonically.
            orderBy: dueDateFilter
              ? [{ dueDate: 'asc' }, { id: 'asc' }]
              : [{ updatedAt: 'desc' }, { id: 'desc' }],
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
        // scopeCacheTag keeps scoped users out of the org-shared cache entry.
        { ttlSeconds: 20, tags: ['opportunities-list', scopeCacheTag(accessScope)] },
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
      // Scoped alongside the list so badge counts match the visible rows.
      const accessScope = await getAccessScope(req.auth.orgId, req.auth.userId);
      return req.cache(
        async () => {
          const count = await prisma.opportunity.count({
            where: applyOpportunityScope(
              {
                orgId: req.auth.orgId,
                deletedAt: null,
                ...(pipelineStageId ? { pipelineStageId } : {}),
                ...(excludeClosed
                  ? { stage: { notIn: ['closed_won', 'closed_lost'] as PrismaStage[] } }
                  : {}),
              },
              accessScope,
            ),
          });
          return { count };
        },
        { ttlSeconds: 20, tags: ['opportunities-count', scopeCacheTag(accessScope)] },
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
      // M7 access scoping also applies to detail-by-id: a country-restricted
      // user must not open an out-of-scope opportunity by direct link/ID. Same
      // visibility predicate as the list/count paths -> out-of-scope = 404.
      const accessScope = await getAccessScope(req.auth.orgId, req.auth.userId);
      const opp = await prisma.opportunity.findFirst({
        where: applyOpportunityScope(
          { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
          accessScope,
        ),
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
      // a 500. Raw SQL (not prisma.opportunity.updateMany) deliberately, so it
      // does not touch updated_at — Prisma's @updatedAt fires on every ORM
      // update/updateMany regardless of the data payload, and a page view
      // silently bumping updatedAt would invalidate every client's in-flight
      // optimistic-concurrency token (expectedUpdatedAt) on a no-op read.
      void prisma.$executeRaw`UPDATE opportunities SET view_count = view_count + 1 WHERE id = ${opp.id}::uuid AND org_id = ${req.auth.orgId}::uuid`.catch(
        (err: unknown) => {
          req.log.warn({ err, opportunityId: opp.id }, 'Failed to update opportunity view count');
        },
      );
      const customFieldValues = await prisma.customFieldValue.findMany({
        where: { orgId: req.auth.orgId, entityType: 'opportunity', entityId: opp.id },
        select: { id: true, definitionId: true, value: true },
        take: 100,
      });
      const full = serializeOpportunityFull(opp);
      // Live buying-intent augmentation: merges Sillage signals into
      // intel.triggers on read, gated on SILLAGE_* env so this is a zero-cost
      // no-op until an operator configures it (see lib/sillage-intel-augment.ts).
      // This query doesn't load the company relation (only owner/territory/
      // pipelineStage above), so we pass companyName only — Sillage accepts a
      // company name alone, and adding a join just for a domain isn't worth it.
      const intel = sillageIsConfigured()
        ? ((await augmentTriggersWithSillage(full.intel, {
            companyName: opp.customer,
            logger: req.log,
          })) as OpportunityFull['intel'])
        : full.intel;
      return { ...full, intel, customFieldValues };
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

      // Optimistic-concurrency fail-fast: cheap check before the lookups below
      // run. The transaction's CAS updateMany re-checks atomically, so this
      // only shortcuts the common case — it does not replace the real guard.
      if (
        req.body.expectedUpdatedAt !== undefined &&
        new Date(req.body.expectedUpdatedAt).getTime() !== before.updatedAt.getTime()
      ) {
        throw server.httpErrors.conflict(
          'Opportunity was modified since you loaded it — reload and retry',
        );
      }

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

      // Re-link to a Company when the customer changes (link-only-if-exists;
      // never auto-creates from free text). A customer with no matching Company
      // clears the stale link so companyId always reflects the current customer.
      let companyIdUpdate: string | null | undefined = undefined;
      if (req.body.customer !== undefined) {
        companyIdUpdate = await resolveCompanyIdByName(
          prisma,
          req.auth.orgId,
          req.body.customer,
        );
      }

      const dataPatch = {
        ...(req.body.customer ? { customer: req.body.customer } : {}),
        ...(companyIdUpdate !== undefined ? { companyId: companyIdUpdate } : {}),
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
      };

      // Update + audit atomic so a crash mid-mutation can't leave an opp
      // changed without a paper trail (Arch-4). Interactive transaction (not
      // the array form) so the CAS updateMany below can abort the whole write
      // — including the audit log and CF upserts — on a lost race, instead of
      // logging a change that never landed.
      const txResult = await prisma.$transaction(async (tx) => {
        if (req.body.expectedUpdatedAt !== undefined) {
          const cas = await tx.opportunity.updateMany({
            where: {
              id: before.id,
              orgId: req.auth.orgId,
              updatedAt: new Date(req.body.expectedUpdatedAt as string),
            },
            data: dataPatch,
          });
          if (cas.count === 0) return { conflict: true as const };
        } else {
          await tx.opportunity.update({ where: { id: before.id }, data: dataPatch });
        }

        // CF upserts included in the same transaction so a CF failure rolls back
        // the opportunity update — prevents partial-update / data corruption (P0 #5).
        for (const { definitionId, value } of req.body.customFieldValues ?? []) {
          await tx.customFieldValue.upsert({
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
          });
        }

        await tx.auditLog.create({
          data: {
            orgId: req.auth.orgId,
            userId: req.auth.userId,
            action: 'opportunity.update',
            targetType: 'opportunity',
            targetId: before.id,
            diff: req.body as object,
          },
        });

        const updated = await tx.opportunity.findFirst({
          where: { id: before.id },
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
        });
        return { conflict: false as const, updated: updated! };
      });

      if (txResult.conflict) {
        throw server.httpErrors.conflict(
          'Opportunity was modified since you loaded it — reload and retry',
        );
      }
      const updated = txResult.updated;

      // Fire-and-forget push to Dust on any field update.
      void pushOpportunityToDust(updated.id, req.auth.orgId);

      // Notify the owner on a real stage change made by someone else — awaited
      // (not void) so the write is durable before the response returns, but
      // failure is swallowed so a notification hiccup can never fail an
      // otherwise-successful PATCH (item 3c: deadline-discipline cluster).
      const stageChanged =
        updated.stage !== before.stage || updated.pipelineStageId !== before.pipelineStageId;
      if (stageChanged && updated.ownerId && updated.ownerId !== req.auth.userId) {
        await createNotification({
          orgId: req.auth.orgId,
          userId: updated.ownerId,
          type: 'stage_change',
          title: `${updated.name} moved to a new stage`,
          body: `${updated.customer} — now in ${updated.pipelineStage?.name ?? updated.stage}`,
          entityType: 'opportunity',
          entityId: updated.id,
          url: `/opportunities/${updated.id}`,
        }).catch((err: unknown) => {
          req.log.warn({ err, opportunityId: updated.id }, 'stage-change notification failed');
        });
      }

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

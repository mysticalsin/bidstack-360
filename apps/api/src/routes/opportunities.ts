// Opportunity routes per handoff/openapi.yaml.
// All queries scoped by req.auth.orgId.

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma, Prisma, type OpportunityStage as PrismaStage } from '@bidstack/db';
import { pushOpportunityToDust } from '../lib/dust-push.js';
import { fanOutWebhookEvent } from '../queues/webhook-delivery.js';
import {
  Opportunity,
  OpportunityCreate,
  OpportunityFilter,
  OpportunityFull,
  OpportunityImport,
  OpportunityImportResult,
  OpportunityPage,
  OpportunityPatch,
} from '@bidstack/shared';

import { serializeOpportunity, serializeOpportunityFull } from '../serializers/opportunity.js';

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
      // Batch-fetch comment counts for the page
      const commentCounts =
        page.length > 0
          ? await prisma.comment.groupBy({
              by: ['targetId'],
              where: {
                orgId: req.auth.orgId,
                targetType: 'opportunity',
                targetId: { in: page.map((o) => o.id) },
              },
              _count: { targetId: true },
            })
          : [];
      const commentCountById = new Map(commentCounts.map((c) => [c.targetId, c._count.targetId]));
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
      const count = await prisma.opportunity.count({
        where: {
          orgId: req.auth.orgId,
          ...(pipelineStageId ? { pipelineStageId } : {}),
          ...(excludeClosed
            ? { stage: { notIn: ['closed_won', 'closed_lost'] as PrismaStage[] } }
            : {}),
        },
      });
      return { count };
    },
  );

  // POST /api/opportunities
  server.post(
    '/opportunities',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        body: OpportunityCreate,
        response: { 201: Opportunity },
      },
    },
    async (req, reply) => {
      const body = req.body;
      // Resolve owner email to ownerId if provided
      let ownerId: string | null | undefined = undefined;
      if (body.owner !== undefined && body.owner !== null) {
        const ownerUser = await prisma.user.findFirst({
          where: { email: body.owner, orgId: req.auth.orgId },
          select: { id: true },
        });
        if (!ownerUser) throw server.httpErrors.badRequest('Owner user not found');
        ownerId = ownerUser.id;
      } else if (body.owner === null) {
        ownerId = null;
      }

      // Auto-assign territory from country if not explicitly provided
      let territoryId: string | null | undefined = body.territoryId;
      if (territoryId === undefined && body.country) {
        const territory = await prisma.territory.findFirst({
          where: {
            orgId: req.auth.orgId,
            active: true,
            countryCodes: { has: body.country },
          },
          select: { id: true },
        });
        if (territory) territoryId = territory.id;
      }

      // Resolve pipeline stage — validate provided or look up default.
      let pipelineStageId = body.pipelineStageId;
      let stageKey: PrismaStage = 's1_lead';
      if (pipelineStageId) {
        const ps = await prisma.pipelineStage.findFirst({
          where: { id: pipelineStageId, orgId: req.auth.orgId, deletedAt: null },
          select: { key: true },
        });
        if (!ps) throw server.httpErrors.badRequest('Invalid pipeline stage');
        stageKey = ps.key as PrismaStage;
      } else {
        const defaultStage = await prisma.pipelineStage.findFirst({
          where: { orgId: req.auth.orgId, deletedAt: null },
          orderBy: { orderIndex: 'asc' },
          select: { id: true, key: true },
        });
        if (defaultStage) {
          pipelineStageId = defaultStage.id;
          stageKey = defaultStage.key as PrismaStage;
        }
      }

      // Mint code + create + audit atomically; retry on Q-NNNN unique
      // collision with bounded attempts (mirrors sales-orders pattern).
      let createdId: string | null = null;
      for (let attempt = 0; attempt < 5 && !createdId; attempt += 1) {
        try {
          createdId = await prisma.$transaction(async (tx) => {
            const code = body.code ?? (await mintNextCode(tx, req.auth.orgId));
            const created = await tx.opportunity.create({
              data: {
                orgId: req.auth.orgId,
                code,
                customer: body.customer,
                name: body.name,
                stage: stageKey,
                pipelineStageId,
                valueMicros: BigInt(Math.round(body.value * 1_000_000)),
                probability: body.probability,
                dueDate: body.dueDate ? new Date(body.dueDate) : null,
                industry: body.industry,
                logoUrl: body.logo,
                country: body.country ?? null,
                ...(territoryId !== undefined ? { territoryId } : {}),
                intel: {},
                ...(ownerId !== undefined ? { ownerId } : {}),
              },
            });
            await tx.auditLog.create({
              data: {
                orgId: req.auth.orgId,
                userId: req.auth.userId,
                action: 'opportunity.create',
                targetType: 'opportunity',
                targetId: created.id,
                diff: {
                  code,
                  customer: body.customer,
                  name: body.name,
                  pipelineStageId,
                  country: body.country,
                  territoryId,
                },
              },
            });
            return created.id;
          });
        } catch (err) {
          if (isUniqueViolation(err) && attempt < 4) continue;
          throw err;
        }
      }
      if (!createdId) {
        throw server.httpErrors.conflict('Could not allocate a unique opportunity code; retry.');
      }
      // Re-fetch with `orgId` in the filter for defence-in-depth — the id was
      // minted inside our tx so it's safe, but every other read in this file
      // is org-scoped and we don't want to break that invariant.
      const created = await prisma.opportunity.findFirstOrThrow({
        where: { id: createdId, orgId: req.auth.orgId },
        // BS-25: narrow owner select — `owner: true` pulls clerkId, settings,
        // and every User column. Only id/name/email is consumed downstream.
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
      // Fan-out opportunity.created — fire-and-forget (fail-open).
      void fanOutWebhookEvent(req.auth.orgId, 'opportunity.created', {
        id: created.id,
        name: created.name,
        valueMicros: created.valueMicros,
        pipelineStageId: created.pipelineStage?.id ?? null,
        stageName: created.pipelineStage?.name ?? null,
      });
      return reply.code(201).send(serializeOpportunity(created));
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
      // Increment view count — awaited so it actually lands (Fastify
      // cancels dangling promises when the reply is sent).
      await prisma.opportunity.update({
        where: { id: opp.id },
        data: { viewCount: { increment: 1 } },
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
      // Auto-assign territory if country changed and territoryId not explicitly set
      let territoryId: string | null | undefined = req.body.territoryId;
      if (
        territoryId === undefined &&
        req.body.country !== undefined &&
        req.body.country !== before.country
      ) {
        const territory = await prisma.territory.findFirst({
          where: {
            orgId: req.auth.orgId,
            active: true,
            countryCodes: { has: req.body.country },
          },
          select: { id: true },
        });
        territoryId = territory?.id ?? null;
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
            where: { id: req.body.pipelineStageId, orgId: req.auth.orgId, deletedAt: null },
            select: { key: true },
          });
          if (!ps) throw server.httpErrors.badRequest('Invalid pipeline stage');
          stageUpdate = ps.key as PrismaStage;
        }
      } else if (req.body.stage !== undefined && req.body.stage !== null) {
        stageUpdate = req.body.stage as PrismaStage;
      }

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
            ...(req.body.owner !== undefined && req.body.owner !== null
              ? {
                  ownerId: (
                    await prisma.user.findFirst({
                      where: { email: req.body.owner, orgId: req.auth.orgId },
                      select: { id: true },
                    })
                  )?.id,
                }
              : req.body.owner === null
                ? { ownerId: null }
                : {}),
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
      ]);

      if (req.body.customFieldValues !== undefined) {
        for (const { definitionId, value } of req.body.customFieldValues) {
          await prisma.customFieldValue.upsert({
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
      }

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

  // POST /api/opportunities/import
  server.post(
    '/opportunities/import',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        body: OpportunityImport,
        response: { 200: OpportunityImportResult },
      },
    },
    async (req) => {
      const { opportunities } = req.body;
      const errors: Array<{ index: number; message: string }> = [];
      let created = 0;

      for (let i = 0; i < opportunities.length; i += 1) {
        const row = opportunities[i];
        if (!row) continue;
        try {
          let ownerId: string | null | undefined = undefined;
          if (row.owner !== undefined && row.owner !== null) {
            const ownerUser = await prisma.user.findFirst({
              where: { email: row.owner, orgId: req.auth.orgId },
              select: { id: true },
            });
            if (!ownerUser) {
              errors.push({ index: i, message: `Owner user not found: ${row.owner}` });
              continue;
            }
            ownerId = ownerUser.id;
          } else if (row.owner === null) {
            ownerId = null;
          }

          // Auto-assign territory from country
          let territoryId: string | null = null;
          if (row.country) {
            const territory = await prisma.territory.findFirst({
              where: {
                orgId: req.auth.orgId,
                active: true,
                countryCodes: { has: row.country },
              },
              select: { id: true },
            });
            if (territory) territoryId = territory.id;
          }

          // Resolve pipeline stage — validate provided or look up default.
          let pipelineStageId = row.pipelineStageId;
          let stageKey: PrismaStage = 's1_lead';
          if (pipelineStageId) {
            const ps = await prisma.pipelineStage.findFirst({
              where: { id: pipelineStageId, orgId: req.auth.orgId, deletedAt: null },
              select: { key: true },
            });
            if (!ps) {
              errors.push({ index: i, message: `Invalid pipeline stage: ${pipelineStageId}` });
              continue;
            }
            stageKey = ps.key as PrismaStage;
          } else {
            const defaultStage = await prisma.pipelineStage.findFirst({
              where: { orgId: req.auth.orgId, deletedAt: null },
              orderBy: { orderIndex: 'asc' },
              select: { id: true, key: true },
            });
            if (defaultStage) {
              pipelineStageId = defaultStage.id;
              stageKey = defaultStage.key as PrismaStage;
            }
          }

          let createdId: string | null = null;
          for (let attempt = 0; attempt < 5 && !createdId; attempt += 1) {
            try {
              createdId = await prisma.$transaction(async (tx) => {
                const code = row.code ?? (await mintNextCode(tx, req.auth.orgId));
                const o = await tx.opportunity.create({
                  data: {
                    orgId: req.auth.orgId,
                    code,
                    customer: row.customer,
                    name: row.name,
                    stage: stageKey,
                    pipelineStageId,
                    valueMicros: BigInt(Math.round(row.value * 1_000_000)),
                    probability: row.probability,
                    dueDate: row.dueDate ? new Date(row.dueDate) : null,
                    industry: row.industry,
                    logoUrl: row.logo,
                    country: row.country ?? null,
                    ...(territoryId !== null ? { territoryId } : {}),
                    intel: {},
                    ...(ownerId !== undefined ? { ownerId } : {}),
                  },
                });
                await tx.auditLog.create({
                  data: {
                    orgId: req.auth.orgId,
                    userId: req.auth.userId,
                    action: 'opportunity.create',
                    targetType: 'opportunity',
                    targetId: o.id,
                    diff: {
                      code,
                      customer: row.customer,
                      name: row.name,
                      pipelineStageId,
                      source: 'import',
                    },
                  },
                });
                return o.id;
              });
            } catch (err) {
              if (isUniqueViolation(err) && attempt < 4) continue;
              throw err;
            }
          }
          if (createdId) created += 1;
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          errors.push({ index: i, message });
        }
      }

      return { created, errors };
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

async function mintNextCode(tx: Prisma.TransactionClient, orgId: string): Promise<string> {
  // Reads inside the active transaction so a concurrent create's row is
  // visible to whichever attempt wins. Unique violation on collision is
  // caught by the caller's bounded retry loop.
  const last = await tx.opportunity.findFirst({
    where: { orgId, code: { startsWith: 'OP-' }, deletedAt: null },
    orderBy: { code: 'desc' },
    select: { code: true },
  });
  if (!last) return 'OP-2001';
  const n = Number(last.code.slice(3));
  return `OP-${(n + 1).toString().padStart(4, '0')}`;
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

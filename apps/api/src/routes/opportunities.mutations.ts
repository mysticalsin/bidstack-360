/**
 * opportunities.mutations.ts — POST create and bulk import sub-plugin.
 *
 * WHY separate from opportunities.ts: both creation handlers are long (~160 +
 * ~150 lines), share the mintNextCode + isUniqueViolation + reference-data
 * pre-loading pattern, and have no overlap with the CRUD read/patch/delete
 * handlers. Splitting them here keeps every file under the 400-line cap.
 *
 * Import DAG: opportunities.helpers (leaf) ← this file ← opportunities.ts
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { prisma, type OpportunityStage as PrismaStage } from '@bidstack/db';
import {
  Opportunity,
  OpportunityCreate,
  OpportunityImport,
  OpportunityImportResult,
} from '@bidstack/shared';
import { fanOutWebhookEvent } from '../queues/webhook-delivery.js';
import { serializeOpportunity } from '../serializers/opportunity.js';
import { isUniqueViolation, mintNextCode } from './opportunities.helpers.js';

export const opportunityMutationsRoutes: FastifyPluginAsyncZod = async (server) => {
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

      // WHY: owner and territory lookups are independent — run them in parallel
      // to halve the round-trips when both fields are provided.
      const needsOwnerLookup = body.owner !== undefined && body.owner !== null;
      const needsTerritoryLookup = body.territoryId === undefined && !!body.country;
      const [ownerUser, territory] = await Promise.all([
        needsOwnerLookup
          ? prisma.user.findFirst({
              where: { email: body.owner as string, orgId: req.auth.orgId },
              select: { id: true },
            })
          : Promise.resolve(null),
        needsTerritoryLookup
          ? prisma.territory.findFirst({
              where: {
                orgId: req.auth.orgId,
                active: true,
                countryCodes: { has: body.country as string },
              },
              select: { id: true },
            })
          : Promise.resolve(null),
      ]);

      // Resolve owner
      let ownerId: string | null | undefined = undefined;
      if (needsOwnerLookup) {
        if (!ownerUser) throw server.httpErrors.badRequest('Owner user not found');
        ownerId = ownerUser.id;
      } else if (body.owner === null) {
        ownerId = null;
      }

      // Auto-assign territory from country if not explicitly provided
      let territoryId: string | null | undefined = body.territoryId;
      if (needsTerritoryLookup && territory) {
        territoryId = territory.id;
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

      // WHY: pre-load all reference data once before the loop to eliminate
      // N+1 queries (3–4 DB round-trips per row → 3 queries total regardless
      // of import batch size).
      const uniqueOwnerEmails = [
        ...new Set(
          opportunities
            .map((r) => r.owner)
            .filter((o): o is string => o !== undefined && o !== null),
        ),
      ];
      const [importTerritories, importOwnerUsers, importPipelineStages] = await Promise.all([
        prisma.territory.findMany({
          where: { orgId: req.auth.orgId, active: true },
          select: { id: true, countryCodes: true },
        }),
        uniqueOwnerEmails.length > 0
          ? prisma.user.findMany({
              where: { orgId: req.auth.orgId, email: { in: uniqueOwnerEmails } },
              select: { id: true, email: true },
            })
          : Promise.resolve([]),
        prisma.pipelineStage.findMany({
          where: { orgId: req.auth.orgId, deletedAt: null },
          orderBy: { orderIndex: 'asc' },
          select: { id: true, key: true },
        }),
      ]);

      // Build lookup maps once — O(1) access per row.
      const countryToTerritoryId = new Map<string, string>();
      for (const t of importTerritories) {
        for (const cc of t.countryCodes) {
          if (!countryToTerritoryId.has(cc)) countryToTerritoryId.set(cc, t.id);
        }
      }
      const emailToUserId = new Map<string, string>(
        importOwnerUsers.filter((u) => u.email !== null).map((u) => [u.email as string, u.id]),
      );
      const stageById = new Map(importPipelineStages.map((s) => [s.id, s]));
      const defaultImportStage = importPipelineStages[0];

      for (let i = 0; i < opportunities.length; i += 1) {
        const row = opportunities[i];
        if (!row) continue;
        try {
          let ownerId: string | null | undefined = undefined;
          if (row.owner !== undefined && row.owner !== null) {
            const userId = emailToUserId.get(row.owner);
            if (!userId) {
              errors.push({ index: i, message: `Owner user not found: ${row.owner}` });
              continue;
            }
            ownerId = userId;
          } else if (row.owner === null) {
            ownerId = null;
          }

          // Auto-assign territory from country (map lookup — no DB query)
          let territoryId: string | null = null;
          if (row.country) {
            territoryId = countryToTerritoryId.get(row.country) ?? null;
          }

          // Resolve pipeline stage (map lookup — no DB query per row)
          let pipelineStageId = row.pipelineStageId;
          let stageKey: PrismaStage = 's1_lead';
          if (pipelineStageId) {
            const ps = stageById.get(pipelineStageId);
            if (!ps) {
              errors.push({ index: i, message: `Invalid pipeline stage: ${pipelineStageId}` });
              continue;
            }
            stageKey = ps.key as PrismaStage;
          } else if (defaultImportStage) {
            pipelineStageId = defaultImportStage.id;
            stageKey = defaultImportStage.key as PrismaStage;
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
};

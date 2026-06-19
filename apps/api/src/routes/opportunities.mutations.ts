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
import { randomUUID } from 'node:crypto';

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
import { isUniqueViolation, mintNextCode, mintNextCodes } from './opportunities.helpers.js';

export const opportunityMutationsRoutes: FastifyPluginAsyncZod = async (server) => {

  // RBAC: gate every route in this plugin. requirePermission throws 403 when the
  // caller's roles lack the key (no admin claim-fallback). Runs after the global
  // auth onRequest, so req.auth is populated.
  server.addHook('preHandler', server.requirePermission('opportunities:write'));
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

      // Phase 1: validate all rows against in-memory maps — zero DB queries.
      // WHY batch approach: previous sequential loop issued 3 DB round-trips per row
      // (mintNextCode + create + audit). A single transaction with createMany collapses
      // that to ~3 queries total regardless of import batch size (1 findFirst for max
      // code + 1 createMany for opportunities + 1 createMany for audit logs).
      interface ValidRow {
        index: number;
        /** Pre-generated UUID so audit log can reference the opportunity id before it exists. */
        id: string;
        ownerId: string | null | undefined;
        territoryId: string | null;
        pipelineStageId: string | null | undefined;
        stageKey: PrismaStage;
        row: (typeof opportunities)[number];
      }
      const validRows: ValidRow[] = [];

      for (let i = 0; i < opportunities.length; i += 1) {
        const row = opportunities[i];
        if (!row) continue;

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

        validRows.push({
          index: i,
          id: randomUUID(),
          ownerId,
          territoryId,
          pipelineStageId,
          stageKey,
          row,
        });
      }

      if (validRows.length > 0) {
        // Phase 2: single transaction — 1 findFirst + 2 createMany ≈ 3 queries for any N.
        // On unique-code collision (concurrent imports), retry up to 5 times; mintedCodes
        // is rebuilt fresh each attempt so codes are re-generated rather than replayed.
        for (let attempt = 0; attempt < 5; attempt += 1) {
          try {
            await prisma.$transaction(async (tx) => {
              // Mint codes for all rows that didn't supply one — single read inside the
              // transaction so a concurrent import's just-inserted row is visible and we
              // don't collide on the sequence counter.
              const needsMinting = validRows.filter((vr) => !vr.row.code);
              const mintedCodes = new Map<number, string>(); // row index → assigned code
              if (needsMinting.length > 0) {
                // No deletedAt filter — soft-deleted rows still own their code under
                // the (orgId, code) unique key; see mintNextCode. (Review finding.)
                const codes = await mintNextCodes(tx, req.auth.orgId, needsMinting.length);
                needsMinting.forEach((vr, index) => mintedCodes.set(vr.index, codes[index]!));
              }

              await tx.opportunity.createMany({
                data: validRows.map((vr) => {
                  const code = vr.row.code ?? mintedCodes.get(vr.index)!;
                  return {
                    id: vr.id,
                    orgId: req.auth.orgId,
                    code,
                    customer: vr.row.customer,
                    name: vr.row.name,
                    stage: vr.stageKey,
                    pipelineStageId: vr.pipelineStageId ?? undefined,
                    valueMicros: BigInt(Math.round(vr.row.value * 1_000_000)),
                    probability: vr.row.probability,
                    dueDate: vr.row.dueDate ? new Date(vr.row.dueDate) : null,
                    industry: vr.row.industry ?? null,
                    logoUrl: vr.row.logo ?? null,
                    country: vr.row.country ?? null,
                    intel: {},
                    ...(vr.territoryId !== null ? { territoryId: vr.territoryId } : {}),
                    ...(vr.ownerId !== undefined ? { ownerId: vr.ownerId } : {}),
                  };
                }),
              });

              await tx.auditLog.createMany({
                data: validRows.map((vr) => ({
                  orgId: req.auth.orgId,
                  userId: req.auth.userId,
                  action: 'opportunity.create',
                  targetType: 'opportunity',
                  targetId: vr.id,
                  diff: {
                    code: vr.row.code ?? mintedCodes.get(vr.index),
                    customer: vr.row.customer,
                    name: vr.row.name,
                    pipelineStageId: vr.pipelineStageId,
                    source: 'import',
                  },
                })),
              });
            });

            created = validRows.length;
            break;
          } catch (err) {
            if (isUniqueViolation(err) && attempt < 4) continue;
            throw err;
          }
        }
      }

      return { created, errors };
    },
  );
};

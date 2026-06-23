/**
 * kam-initiatives.ts — KAM Initiative CRUD + the locked state machine.
 *
 * Initiative → Lead → Opportunity → Dropped. Reaching `opportunity` mints a
 * real Opportunity (shared mint primitive) AND a KamHandoff in ONE transaction,
 * guarded by an optimistic stage flip (no double-mint). Every referenced id is
 * re-validated against the caller's org (FK-graft guard, B3) and the account is
 * checked against the caller's access scope (B4). See docs/KAM-PLAN.md.
 */
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma, type Prisma } from '@bidstack/db';
import {
  INITIATIVE_STAGES,
  isAllowedInitiativeTransition,
  KamInitiativeCreate,
  KamInitiativeDetail,
  KamInitiativeList,
  KamInitiativePatch,
  KamInitiativeTransitionBody,
  type InitiativeStageValue,
} from '@bidstack/shared';

import {
  assertCompanyVisible as assertCompanyVisibleShared,
  assertUserInOrg as assertUserInOrgShared,
} from './kam-access.js';
import { mintOpportunityTx, withOpportunityCodeRetry } from '../services/opportunities/mint.js';

type InitiativeRow = Prisma.KamInitiativeGetPayload<{ include: { handoff: { select: { id: true } } } }>;

function toDetail(row: InitiativeRow): z.infer<typeof KamInitiativeDetail> {
  return {
    id: row.id,
    companyId: row.companyId,
    sessionId: row.sessionId,
    title: row.title,
    description: row.description,
    stage: row.stage as InitiativeStageValue,
    ownerId: row.ownerId,
    priority: row.priority,
    estimatedValueMicros: row.estimatedValueMicros == null ? null : Number(row.estimatedValueMicros),
    lastActivityAt: row.lastActivityAt.toISOString(),
    droppedReason: row.droppedReason,
    convertedToOpportunityId: row.convertedToOpportunityId,
    handoffId: row.handoff?.id ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const kamInitiativeRoutes: FastifyPluginAsyncZod = async (server) => {
  // ── Guards (B3 FK-graft + B4 access-scope) — single impl in kam-access.ts ──
  const assertCompanyVisible = (req: FastifyRequest, companyId: string) =>
    assertCompanyVisibleShared(server, req, companyId);
  const assertUserInOrg = (req: FastifyRequest, userId: string) =>
    assertUserInOrgShared(server, req, userId);

  async function assertSessionInCompany(
    req: FastifyRequest,
    sessionId: string,
    companyId: string,
  ): Promise<void> {
    const session = await prisma.kamSession.findFirst({
      where: { id: sessionId, orgId: req.auth.orgId, companyId, deletedAt: null },
      select: { id: true },
    });
    if (!session) throw server.httpErrors.badRequest('Session not found for this account');
  }

  async function loadInitiativeOr404(req: FastifyRequest, id: string): Promise<InitiativeRow> {
    const init = await prisma.kamInitiative.findFirst({
      where: { id, orgId: req.auth.orgId, deletedAt: null },
      include: { handoff: { select: { id: true } } },
    });
    if (!init) throw server.httpErrors.notFound('Initiative not found');
    await assertCompanyVisible(req, init.companyId);
    return init;
  }

  // ── List (per-account) ───────────────────────────────────────────────────
  server.get(
    '/kam/initiatives',
    {
      preHandler: server.requirePermission('kam:read'),
      schema: {
        querystring: z.object({
          companyId: z.string().uuid(),
          stage: z.enum(INITIATIVE_STAGES).optional(),
          cursor: z.string().uuid().optional(),
          limit: z.coerce.number().int().min(1).max(100).default(50),
        }),
        response: { 200: KamInitiativeList },
      },
    },
    async (req) => {
      const { companyId, stage, cursor, limit } = req.query;
      await assertCompanyVisible(req, companyId);
      const rows = await prisma.kamInitiative.findMany({
        where: { orgId: req.auth.orgId, companyId, deletedAt: null, ...(stage ? { stage } : {}) },
        include: { handoff: { select: { id: true } } },
        orderBy: [{ lastActivityAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      return { items: page.map(toDetail), nextCursor: hasMore ? page[page.length - 1]!.id : null };
    },
  );

  // ── Get one ────────────────────────────────────────────────────────────
  server.get(
    '/kam/initiatives/:id',
    {
      preHandler: server.requirePermission('kam:read'),
      schema: { params: z.object({ id: z.string().uuid() }), response: { 200: KamInitiativeDetail } },
    },
    async (req) => toDetail(await loadInitiativeOr404(req, req.params.id)),
  );

  // ── Create ───────────────────────────────────────────────────────────────
  server.post(
    '/kam/initiatives',
    {
      preHandler: server.requirePermission('kam:write'),
      schema: { body: KamInitiativeCreate, response: { 201: KamInitiativeDetail } },
    },
    async (req, reply) => {
      const body = req.body;
      await assertCompanyVisible(req, body.companyId);
      if (body.ownerId) await assertUserInOrg(req, body.ownerId);
      if (body.sessionId) await assertSessionInCompany(req, body.sessionId, body.companyId);

      const created = await prisma.kamInitiative.create({
        data: {
          orgId: req.auth.orgId,
          companyId: body.companyId,
          sessionId: body.sessionId ?? null,
          title: body.title,
          description: body.description ?? null,
          ownerId: body.ownerId ?? null,
          priority: body.priority ?? 'medium',
          estimatedValueMicros:
            body.estimatedValueMicros === undefined ? null : BigInt(body.estimatedValueMicros),
          createdById: req.auth.userId,
        },
        include: { handoff: { select: { id: true } } },
      });
      reply.code(201);
      return toDetail(created);
    },
  );

  // ── Patch (edit fields; NOT stage — use the transition endpoint) ─────────
  server.patch(
    '/kam/initiatives/:id',
    {
      preHandler: server.requirePermission('kam:write'),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: KamInitiativePatch,
        response: { 200: KamInitiativeDetail },
      },
    },
    async (req) => {
      const existing = await loadInitiativeOr404(req, req.params.id);
      const body = req.body;
      if (body.ownerId) await assertUserInOrg(req, body.ownerId);
      const updated = await prisma.kamInitiative.update({
        where: { id: existing.id },
        data: {
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.ownerId !== undefined ? { ownerId: body.ownerId } : {}),
          ...(body.priority !== undefined ? { priority: body.priority } : {}),
          ...(body.estimatedValueMicros !== undefined
            ? {
                estimatedValueMicros:
                  body.estimatedValueMicros === null ? null : BigInt(body.estimatedValueMicros),
              }
            : {}),
          lastActivityAt: new Date(),
        },
        include: { handoff: { select: { id: true } } },
      });
      return toDetail(updated);
    },
  );

  // ── Transition (the locked state machine) ────────────────────────────────
  server.post(
    '/kam/initiatives/:id/transition',
    {
      preHandler: server.requirePermission('kam:write'),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: KamInitiativeTransitionBody,
        response: { 200: KamInitiativeDetail },
      },
    },
    async (req) => {
      const { id } = req.params;
      const body = req.body;
      const init = await loadInitiativeOr404(req, id);
      const company = await assertCompanyVisible(req, init.companyId);

      const fromStage = init.stage as InitiativeStageValue;
      const toStage = body.toStage;
      if (!isAllowedInitiativeTransition(fromStage, toStage)) {
        throw server.httpErrors.conflict(`Illegal transition: ${fromStage} → ${toStage}`);
      }
      if (toStage === 'dropped' && !body.droppedReason?.trim()) {
        throw server.httpErrors.badRequest('droppedReason is required to drop an initiative');
      }
      const now = new Date();

      const run = () =>
        prisma.$transaction(async (tx) => {
          // Optimistic flip — the concurrency gate. Two concurrent →opportunity
          // requests both pass the checks above, but only ONE updateMany matches
          // (stage=fromStage AND not-yet-converted); the loser's count===0 throws
          // 409 and rolls back any Opportunity/Handoff it created.
          const flip = await tx.kamInitiative.updateMany({
            where: {
              id,
              orgId: req.auth.orgId,
              stage: fromStage,
              convertedToOpportunityId: null,
              deletedAt: null,
            },
            data: {
              stage: toStage,
              lastActivityAt: now,
              ...(toStage === 'dropped' ? { droppedReason: body.droppedReason!.trim() } : {}),
              ...(body.estimatedValueMicros !== undefined
                ? { estimatedValueMicros: BigInt(body.estimatedValueMicros) }
                : {}),
            },
          });
          if (flip.count === 0) {
            throw server.httpErrors.conflict('Initiative changed concurrently; reload and retry');
          }

          let opportunityId: string | null = null;
          if (toStage === 'opportunity') {
            const valueMicros =
              body.estimatedValueMicros !== undefined
                ? BigInt(body.estimatedValueMicros)
                : (init.estimatedValueMicros ?? BigInt(0));
            const opp = await mintOpportunityTx(tx, {
              orgId: req.auth.orgId,
              companyId: init.companyId,
              customer: company.name,
              name: body.opportunityName ?? init.title,
              valueMicros,
              ownerId: init.ownerId,
              pipelineStageId: body.pipelineStageId,
            });
            await tx.kamHandoff.create({
              data: {
                orgId: req.auth.orgId,
                companyId: init.companyId,
                initiativeId: id,
                opportunityId: opp.id,
                status: 'draft',
                targetSystem: 'abc_om',
                exportPayload: {
                  initiativeId: id,
                  title: init.title,
                  companyId: init.companyId,
                  companyName: company.name,
                  estimatedValueMicros: Number(valueMicros),
                  opportunityId: opp.id,
                  opportunityCode: opp.code,
                } as Prisma.InputJsonValue,
                createdById: req.auth.userId,
              },
            });
            await tx.kamInitiative.update({
              where: { id },
              data: { convertedToOpportunityId: opp.id },
            });
            opportunityId = opp.id;
          }

          await tx.auditLog.create({
            data: {
              orgId: req.auth.orgId,
              userId: req.auth.userId,
              action: 'kam_initiative.transition',
              targetType: 'kam_initiative',
              targetId: id,
              diff: { from: fromStage, to: toStage, opportunityId } as Prisma.InputJsonValue,
            },
          });

          return tx.kamInitiative.findFirstOrThrow({
            where: { id, orgId: req.auth.orgId },
            include: { handoff: { select: { id: true } } },
          });
        });

      return toDetail(await withOpportunityCodeRetry(run));
    },
  );

  // ── Soft delete ──────────────────────────────────────────────────────────
  server.delete(
    '/kam/initiatives/:id',
    {
      preHandler: server.requirePermission('kam:write'),
      schema: { params: z.object({ id: z.string().uuid() }), response: { 204: z.null() } },
    },
    async (req, reply) => {
      const existing = await loadInitiativeOr404(req, req.params.id);
      await prisma.kamInitiative.update({
        where: { id: existing.id },
        data: { deletedAt: new Date() },
      });
      reply.code(204);
      return null;
    },
  );
};

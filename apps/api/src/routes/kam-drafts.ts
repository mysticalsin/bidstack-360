/**
 * kam-drafts.ts — the human-in-the-loop gate.
 *
 * AI-organized notes + extracted to-dos land in a KamSessionDraft (status
 * 'pending'). A HUMAN reviews/edits and approves; ONLY approve commits canonical
 * rows (Initiatives + Tasks + the session note). Hard invariants:
 *   • Approve is forbidden to api-role callers (Dust agents / API keys) — a human
 *     must approve. The kam:write permission is NOT sufficient (scope-collapse).
 *   • Approve is atomic and idempotent: a pending→approved flip guards against
 *     double-approve (no duplicate initiatives/tasks).
 * Reject closes the draft and commits nothing.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma, type Prisma } from '@bidstack/db';
import {
  KamDraftApproveResult,
  type KamDraftContent,
  KamInitiativeDraftItem,
  KamNoteDraft,
  KamSessionDraftCreate,
  KamSessionDraftDetail,
  KamSessionDraftList,
  KamSessionDraftPatch,
  KamTaskDraftItem,
} from '@bidstack/shared';

import { assertCompanyVisible } from './kam-access.js';

type DraftRow = Prisma.KamSessionDraftGetPayload<Record<string, never>>;

function toDraftDetail(row: DraftRow): z.infer<typeof KamSessionDraftDetail> {
  return {
    id: row.id,
    companyId: row.companyId,
    sessionId: row.sessionId,
    status: row.status,
    source: row.source,
    noteDraft: row.noteDraft,
    initiativeDrafts: row.initiativeDrafts,
    taskDrafts: row.taskDrafts,
    lowConfidence: row.lowConfidence,
    reviewedById: row.reviewedById,
    reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

type DraftContentPatch = Partial<z.infer<typeof KamDraftContent>>;

/** Map partial draft content → the Prisma column patch (only provided keys). */
function contentToColumns(content: DraftContentPatch): Record<string, Prisma.InputJsonValue> {
  const data: Record<string, Prisma.InputJsonValue> = {};
  if (content.noteDraft !== undefined) data.noteDraft = content.noteDraft as Prisma.InputJsonValue;
  if (content.initiativeDrafts !== undefined) data.initiativeDrafts = content.initiativeDrafts as Prisma.InputJsonValue;
  if (content.taskDrafts !== undefined) data.taskDrafts = content.taskDrafts as Prisma.InputJsonValue;
  if (content.lowConfidence !== undefined) data.lowConfidence = content.lowConfidence as Prisma.InputJsonValue;
  return data;
}

export const kamDraftRoutes: FastifyPluginAsyncZod = async (server) => {
  async function loadDraftOr404(
    req: Parameters<typeof assertCompanyVisible>[1],
    id: string,
  ): Promise<DraftRow> {
    const draft = await prisma.kamSessionDraft.findFirst({
      where: { id, orgId: req.auth.orgId, deletedAt: null },
    });
    if (!draft) throw server.httpErrors.notFound('Draft not found');
    await assertCompanyVisible(server, req, draft.companyId);
    return draft;
  }

  // ── Create a staging draft for a session ─────────────────────────────────
  server.post(
    '/kam/sessions/:sessionId/drafts',
    {
      preHandler: server.requirePermission('kam:write'),
      schema: {
        params: z.object({ sessionId: z.string().uuid() }),
        body: KamSessionDraftCreate,
        response: { 201: KamSessionDraftDetail },
      },
    },
    async (req, reply) => {
      const session = await prisma.kamSession.findFirst({
        where: { id: req.params.sessionId, orgId: req.auth.orgId, deletedAt: null },
        select: { id: true, companyId: true },
      });
      if (!session) throw server.httpErrors.notFound('Session not found');
      await assertCompanyVisible(server, req, session.companyId);
      const content = req.body.content ?? {};
      const created = await prisma.kamSessionDraft.create({
        data: {
          orgId: req.auth.orgId,
          companyId: session.companyId,
          sessionId: session.id,
          status: 'pending',
          source: req.body.source,
          createdById: req.auth.userId,
          ...contentToColumns(content),
        },
      });
      reply.code(201);
      return toDraftDetail(created);
    },
  );

  server.get(
    '/kam/drafts/:id',
    {
      preHandler: server.requirePermission('kam:read'),
      schema: { params: z.object({ id: z.string().uuid() }), response: { 200: KamSessionDraftDetail } },
    },
    async (req) => toDraftDetail(await loadDraftOr404(req, req.params.id)),
  );

  // ── List drafts for an account (review queue) ────────────────────────────
  server.get(
    '/kam/drafts',
    {
      preHandler: server.requirePermission('kam:read'),
      schema: {
        querystring: z.object({
          companyId: z.string().uuid(),
          status: z.enum(['pending', 'approved', 'rejected']).optional(),
        }),
        response: { 200: KamSessionDraftList },
      },
    },
    async (req) => {
      await assertCompanyVisible(server, req, req.query.companyId);
      const rows = await prisma.kamSessionDraft.findMany({
        where: {
          orgId: req.auth.orgId,
          companyId: req.query.companyId,
          deletedAt: null,
          ...(req.query.status ? { status: req.query.status } : {}),
        },
        orderBy: [{ createdAt: 'desc' }],
        take: 100,
      });
      return { items: rows.map(toDraftDetail) };
    },
  );

  // ── Edit a pending draft ─────────────────────────────────────────────────
  server.patch(
    '/kam/drafts/:id',
    {
      preHandler: server.requirePermission('kam:write'),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: KamSessionDraftPatch,
        response: { 200: KamSessionDraftDetail },
      },
    },
    async (req) => {
      const draft = await loadDraftOr404(req, req.params.id);
      if (draft.status !== 'pending') {
        throw server.httpErrors.conflict('Only pending drafts can be edited');
      }
      const updated = await prisma.kamSessionDraft.update({
        where: { id: draft.id },
        data: contentToColumns(req.body.content),
      });
      return toDraftDetail(updated);
    },
  );

  // ── Approve — THE COMMIT (humans only, atomic, idempotent) ───────────────
  server.post(
    '/kam/drafts/:id/approve',
    {
      preHandler: server.requirePermission('kam:write'),
      schema: { params: z.object({ id: z.string().uuid() }), response: { 200: KamDraftApproveResult } },
    },
    async (req) => {
      // B8.1: kam:write is not sufficient — an api-role caller (Dust agent / API
      // key) must NOT be able to approve. A human actor is required.
      if (req.auth.role === 'api') {
        throw server.httpErrors.forbidden('A human must approve a KAM draft');
      }
      const draft = await loadDraftOr404(req, req.params.id);
      if (draft.status !== 'pending') {
        throw server.httpErrors.conflict('Draft already reviewed');
      }
      // Validate task→initiative index links before committing anything.
      const initiativeDrafts = z.array(KamInitiativeDraftItem).parse(draft.initiativeDrafts);
      const taskDrafts = z.array(KamTaskDraftItem).parse(draft.taskDrafts);
      const note = KamNoteDraft.parse(draft.noteDraft);
      for (const t of taskDrafts) {
        if (t.initiativeIndex >= initiativeDrafts.length) {
          throw server.httpErrors.badRequest(
            `Task "${t.title}" references initiative #${t.initiativeIndex} which is not in the draft`,
          );
        }
      }
      const now = new Date();

      return prisma.$transaction(async (tx) => {
        // Idempotency gate: only one approve wins; loser sees count 0 → 409.
        const flip = await tx.kamSessionDraft.updateMany({
          where: { id: draft.id, orgId: req.auth.orgId, status: 'pending' },
          data: { status: 'approved', reviewedById: req.auth.userId, reviewedAt: now },
        });
        if (flip.count === 0) throw server.httpErrors.conflict('Draft already reviewed');

        const createdInitiativeIds: string[] = [];
        for (const i of initiativeDrafts) {
          const created = await tx.kamInitiative.create({
            data: {
              orgId: req.auth.orgId,
              companyId: draft.companyId,
              sessionId: draft.sessionId,
              title: i.title,
              description: i.description ?? null,
              priority: i.priority ?? 'medium',
              createdById: req.auth.userId,
            },
            select: { id: true },
          });
          createdInitiativeIds.push(created.id);
        }

        const createdTaskIds: string[] = [];
        for (const t of taskDrafts) {
          const task = await tx.task.create({
            data: {
              orgId: req.auth.orgId,
              initiativeId: createdInitiativeIds[t.initiativeIndex]!,
              accountId: draft.companyId,
              title: t.title,
              status: 'open',
              type: t.type ?? null,
              dueDate: t.dueDate ? new Date(t.dueDate) : null,
            },
            select: { id: true },
          });
          createdTaskIds.push(task.id);
        }

        await tx.kamSession.update({
          where: { id: draft.sessionId },
          data: { aiNote: note as Prisma.InputJsonValue, aiNoteStatus: 'approved', committedAt: now },
        });

        await tx.auditLog.create({
          data: {
            orgId: req.auth.orgId,
            userId: req.auth.userId,
            action: 'kam_draft.approve',
            targetType: 'kam_session_draft',
            targetId: draft.id,
            diff: { sessionId: draft.sessionId, createdInitiativeIds, createdTaskIds } as Prisma.InputJsonValue,
          },
        });

        return { sessionId: draft.sessionId, createdInitiativeIds, createdTaskIds };
      });
    },
  );

  // ── Reject — commits nothing ─────────────────────────────────────────────
  server.post(
    '/kam/drafts/:id/reject',
    {
      preHandler: server.requirePermission('kam:write'),
      schema: { params: z.object({ id: z.string().uuid() }), response: { 200: KamSessionDraftDetail } },
    },
    async (req) => {
      const draft = await loadDraftOr404(req, req.params.id);
      if (draft.status !== 'pending') {
        throw server.httpErrors.conflict('Draft already reviewed');
      }
      const updated = await prisma.kamSessionDraft.update({
        where: { id: draft.id },
        data: { status: 'rejected', reviewedById: req.auth.userId, reviewedAt: new Date() },
      });
      return toDraftDetail(updated);
    },
  );
};

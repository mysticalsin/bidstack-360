/**
 * kam-sessions.ts — KAM workshop sessions (transcript holders).
 *
 * Two ingestion paths (brief): manual paste/upload (transcriptText on create)
 * and SharePoint pull. No SharePoint/Graph connector exists in this repo, so
 * the pull endpoint is a defined INTERFACE that returns the manual-import floor
 * until a connector is wired — it never fabricates a transcript.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma, type Prisma } from '@bidstack/db';
import { KamSessionCreate, KamSessionDetail, KamSessionList } from '@bidstack/shared';

import { assertCompanyVisible } from './kam-access.js';

type SessionRow = Prisma.KamSessionGetPayload<Record<string, never>>;

function toSessionDetail(row: SessionRow): z.infer<typeof KamSessionDetail> {
  return {
    id: row.id,
    companyId: row.companyId,
    title: row.title,
    heldAt: row.heldAt.toISOString(),
    sourceType: row.sourceType,
    sourceRef: row.sourceRef,
    attendees: row.attendees,
    consultantIds: row.consultantIds,
    hasTranscript: Boolean(row.transcriptText),
    aiNote: (row.aiNote as unknown) ?? null,
    aiNoteStatus: row.aiNoteStatus,
    committedAt: row.committedAt ? row.committedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export const kamSessionRoutes: FastifyPluginAsyncZod = async (server) => {
  async function loadSessionOr404(
    req: Parameters<typeof assertCompanyVisible>[1],
    id: string,
  ): Promise<SessionRow> {
    const session = await prisma.kamSession.findFirst({
      where: { id, orgId: req.auth.orgId, deletedAt: null },
    });
    if (!session) throw server.httpErrors.notFound('Session not found');
    await assertCompanyVisible(server, req, session.companyId);
    return session;
  }

  // ── Create / ingest ──────────────────────────────────────────────────────
  server.post(
    '/kam/sessions',
    {
      preHandler: server.requirePermission('kam:write'),
      schema: { body: KamSessionCreate, response: { 201: KamSessionDetail } },
    },
    async (req, reply) => {
      const body = req.body;
      await assertCompanyVisible(server, req, body.companyId);
      // Validate consultant ids belong to this account (B3 FK-graft).
      if (body.consultantIds?.length) {
        const found = await prisma.kamConsultant.count({
          where: { id: { in: body.consultantIds }, orgId: req.auth.orgId, companyId: body.companyId, deletedAt: null },
        });
        if (found !== body.consultantIds.length) {
          throw server.httpErrors.badRequest('One or more consultants are not on this account');
        }
      }
      const created = await prisma.kamSession.create({
        data: {
          orgId: req.auth.orgId,
          companyId: body.companyId,
          title: body.title ?? null,
          heldAt: new Date(body.heldAt),
          sourceType: body.sourceType,
          sourceRef: body.sourceRef ?? null,
          attendees: body.attendees ?? [],
          consultantIds: body.consultantIds ?? [],
          transcriptText: body.transcriptText ?? null,
          createdById: req.auth.userId,
        },
      });
      reply.code(201);
      return toSessionDetail(created);
    },
  );

  // ── List (per-account) ─────────────────────────────────────────────────
  server.get(
    '/kam/sessions',
    {
      preHandler: server.requirePermission('kam:read'),
      schema: {
        querystring: z.object({ companyId: z.string().uuid() }),
        response: { 200: KamSessionList },
      },
    },
    async (req) => {
      await assertCompanyVisible(server, req, req.query.companyId);
      const rows = await prisma.kamSession.findMany({
        where: { orgId: req.auth.orgId, companyId: req.query.companyId, deletedAt: null },
        orderBy: [{ heldAt: 'desc' }],
        take: 200,
      });
      return { items: rows.map(toSessionDetail) };
    },
  );

  server.get(
    '/kam/sessions/:id',
    {
      preHandler: server.requirePermission('kam:read'),
      schema: { params: z.object({ id: z.string().uuid() }), response: { 200: KamSessionDetail } },
    },
    async (req) => toSessionDetail(await loadSessionOr404(req, req.params.id)),
  );

  // ── Patch (title / transcript / attendees) ────────────────────────────────
  server.patch(
    '/kam/sessions/:id',
    {
      preHandler: server.requirePermission('kam:write'),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          title: z.string().max(300).nullable().optional(),
          transcriptText: z.string().max(500_000).nullable().optional(),
          attendees: z.array(z.string().max(200)).max(100).optional(),
        }),
        response: { 200: KamSessionDetail },
      },
    },
    async (req) => {
      const existing = await loadSessionOr404(req, req.params.id);
      const body = req.body;
      const updated = await prisma.kamSession.update({
        where: { id: existing.id },
        data: {
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.transcriptText !== undefined ? { transcriptText: body.transcriptText } : {}),
          ...(body.attendees !== undefined ? { attendees: body.attendees } : {}),
        },
      });
      return toSessionDetail(updated);
    },
  );

  // ── SharePoint pull — interface boundary (manual is the floor) ────────────
  server.post(
    '/kam/sessions/:id/pull-transcript',
    {
      preHandler: server.requirePermission('kam:write'),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: z.object({ pulled: z.boolean(), reason: z.string() }) },
      },
    },
    async (req) => {
      const session = await loadSessionOr404(req, req.params.id);
      // No SharePoint/Graph connector is wired in this repo. The interface is
      // defined here so a future connector slots in without route changes; until
      // then the floor is manual import (PATCH transcriptText / paste). We never
      // fabricate a transcript.
      if (!session.sourceRef) {
        throw server.httpErrors.badRequest('No SharePoint sourceRef on this session');
      }
      return {
        pulled: false,
        reason: 'SharePoint connector not configured — import the transcript manually (PATCH transcriptText).',
      };
    },
  );

  // ── Soft delete ──────────────────────────────────────────────────────────
  server.delete(
    '/kam/sessions/:id',
    {
      preHandler: server.requirePermission('kam:write'),
      schema: { params: z.object({ id: z.string().uuid() }), response: { 204: z.null() } },
    },
    async (req, reply) => {
      const existing = await loadSessionOr404(req, req.params.id);
      await prisma.kamSession.update({ where: { id: existing.id }, data: { deletedAt: new Date() } });
      reply.code(204);
      return null;
    },
  );
};

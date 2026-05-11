// Notes routes — CRUD on freeform markdown notes attached to a customer
// account. All queries scope by req.auth.orgId to enforce multi-tenancy.
//
// The route handler intentionally does NOT enforce author === editor on
// PATCH/DELETE. Notes are a team artifact in this product; any org member
// with write scope can edit any note for an account they can see. If/when
// per-note ACLs land, gate them here, not at the storage layer.

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma, type Note as PrismaNote, type User as PrismaUser } from '@bidstack/db';
import { Note, NoteCreate, NoteList, NotePatch } from '@bidstack/shared';

type NoteWithAuthor = PrismaNote & { author: PrismaUser | null };

// accountId is a free-text tag, not a UUID FK. "Aritzia" and "aritzia"
// should resolve to the same account so notes follow the user even if a
// caller is sloppy with capitalization. The cockpit route param lowercases
// via normalizeName(); we mirror at every write/read site so the index
// hits work.
function normalizeAccountId(raw: string): string {
  return raw.trim().toLowerCase();
}

function serializeNote(n: NoteWithAuthor): z.infer<typeof Note> {
  return {
    id: n.id,
    accountId: n.accountId,
    title: n.title,
    bodyMd: n.bodyMd,
    pinned: n.pinned,
    authorUserId: n.authorUserId,
    authorEmail: n.author?.email ?? null,
    createdAt: n.createdAt.toISOString(),
    updatedAt: n.updatedAt.toISOString(),
  };
}

export const notesRoutes: FastifyPluginAsyncZod = async (server) => {
  // GET /api/notes?accountId=<id>
  // accountId is required because returning every note across every account
  // would be unbounded and surface cross-account context the cockpit panel
  // doesn't need.
  server.get(
    '/notes',
    {
      schema: {
        querystring: z.object({
          accountId: z.string().min(1).max(255),
          limit: z.coerce.number().int().min(1).max(200).default(100),
        }),
        response: { 200: NoteList },
      },
    },
    async (req) => {
      const items = await prisma.note.findMany({
        where: { orgId: req.auth.orgId, accountId: normalizeAccountId(req.query.accountId) },
        include: { author: true },
        // Pinned-first, then newest-first within each pinned group. The
        // composite index covers the (orgId, accountId) prefix; the in-memory
        // sort on `pinned` is cheap because limit ≤ 200.
        orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
        take: req.query.limit,
      });
      return { items: items.map(serializeNote) };
    },
  );

  // POST /api/notes
  server.post(
    '/notes',
    {
      schema: {
        body: NoteCreate,
        response: { 201: Note },
      },
    },
    async (req, reply) => {
      const created = await prisma.note.create({
        data: {
          orgId: req.auth.orgId,
          accountId: normalizeAccountId(req.body.accountId),
          authorUserId: req.auth.userId,
          title: req.body.title,
          bodyMd: req.body.bodyMd,
          pinned: req.body.pinned ?? false,
        },
        include: { author: true },
      });
      return reply.code(201).send(serializeNote(created));
    },
  );

  // PATCH /api/notes/:id
  server.patch(
    '/notes/:id',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: NotePatch,
        response: { 200: Note },
      },
    },
    async (req) => {
      // Two-step: findFirst (org-scoped) then update by PK. We can't do an
      // org-scoped update in one call because Prisma's `update` only matches
      // unique keys, and (id, orgId) isn't declared as unique. The findFirst
      // gate is what enforces the tenant boundary.
      const existing = await prisma.note.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId },
        select: { id: true },
      });
      if (!existing) throw server.httpErrors.notFound('Note not found');

      const updated = await prisma.note.update({
        where: { id: existing.id },
        data: {
          ...(req.body.title !== undefined ? { title: req.body.title } : {}),
          ...(req.body.bodyMd !== undefined ? { bodyMd: req.body.bodyMd } : {}),
          ...(req.body.pinned !== undefined ? { pinned: req.body.pinned } : {}),
        },
        include: { author: true },
      });
      return serializeNote(updated);
    },
  );

  // DELETE /api/notes/:id
  server.delete(
    '/notes/:id',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 204: z.null() },
      },
    },
    async (req, reply) => {
      const existing = await prisma.note.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId },
        select: { id: true },
      });
      if (!existing) throw server.httpErrors.notFound('Note not found');

      await prisma.note.delete({ where: { id: existing.id } });
      return reply.code(204).send(null);
    },
  );
};

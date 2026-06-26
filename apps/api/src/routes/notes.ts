// Notes routes — CRUD on freeform markdown notes attached to a customer
// account. All queries scope by req.auth.orgId to enforce multi-tenancy.
//
// The route handler intentionally does NOT enforce author === editor on
// PATCH/DELETE. Notes are a team artifact in this product; any org member
// with write scope can edit any note for an account they can see. If/when
// per-note ACLs land, gate them here, not at the storage layer.

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma, type Prisma, type Note as PrismaNote } from '@bidstack/db';
import {
  MeetingNotesImportRequest,
  MeetingNotesImportResponse,
  Note,
  NoteCreate,
  NoteList,
  NotePatch,
} from '@bidstack/shared';
import { canReadAccount } from '../lib/account-access.js';
import {
  attribution,
  extractMeetingNotes,
  normalizeDomain,
  persistCompliance,
  persistContacts,
  persistMeetingTechStack,
  persistRisks,
  persistTasks,
  asJsonObject,
} from '../services/crm/notes.service.js';

// WHY: only email is needed for the wire shape; fetching the whole User row
// would include clerkId, settings, and other fields irrelevant to note display.
type NoteWithAuthor = PrismaNote & { author: { email: string | null } | null };

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
    companyId: n.companyId ?? undefined,
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
  async function ensureAccountVisible(input: {
    orgId: string;
    userId: string;
    accountId: string;
    companyId?: string | null;
  }) {
    const access = await canReadAccount({
      orgId: input.orgId,
      userId: input.userId,
      accountId: input.accountId,
      companyId: input.companyId,
      prismaClient: prisma,
    });
    if (!access.allowed) throw server.httpErrors.notFound('Account not found');
  }

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
          companyId: z.string().uuid().optional(),
          limit: z.coerce.number().int().min(1).max(200).default(100),
        }),
        response: { 200: NoteList },
      },
    },
    async (req) => {
      await ensureAccountVisible({
        orgId: req.auth.orgId,
        userId: req.auth.userId,
        accountId: req.query.accountId,
        companyId: req.query.companyId,
      });
      const accountId = normalizeAccountId(req.query.accountId);
      const where: Prisma.NoteWhereInput = {
        orgId: req.auth.orgId,
        deletedAt: null,
      };
      if (req.query.companyId) {
        where.OR = [{ companyId: req.query.companyId }, { accountId }];
      } else {
        where.accountId = accountId;
      }
      const items = await prisma.note.findMany({
        where,
        include: { author: { select: { email: true } } },
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
      preHandler: [server.requirePermission('activities:write')],
      schema: {
        body: NoteCreate,
        response: { 201: Note },
      },
    },
    async (req, reply) => {
      await ensureAccountVisible({
        orgId: req.auth.orgId,
        userId: req.auth.userId,
        accountId: req.body.accountId,
        companyId: req.body.companyId,
      });
      const created = await prisma.note.create({
        data: {
          orgId: req.auth.orgId,
          accountId: normalizeAccountId(req.body.accountId),
          companyId: req.body.companyId ?? null,
          authorUserId: req.auth.userId,
          title: req.body.title,
          bodyMd: req.body.bodyMd,
          pinned: req.body.pinned ?? false,
        },
        include: { author: { select: { email: true } } },
      });
      return reply.code(201).send(serializeNote(created));
    },
  );

  // POST /api/notes/import-meeting
  // Paste-first workflow for non-CRM experts: save the raw note, extract the
  // structured CRM signals, then refresh the account cockpit from the same
  // source-attributed data.
  server.post(
    '/notes/import-meeting',
    {
      config: { rateLimit: { max: 15, timeWindow: '1 minute' } },
      preHandler: [server.requirePermission('activities:write')],
      schema: {
        body: MeetingNotesImportRequest,
        response: { 201: MeetingNotesImportResponse },
      },
    },
    async (req, reply) => {
      const accountId = normalizeAccountId(req.body.accountId);
      await ensureAccountVisible({
        orgId: req.auth.orgId,
        userId: req.auth.userId,
        accountId: req.body.accountId,
        companyId: req.body.companyId,
      });
      const companyName = req.body.companyName.trim();
      const importedAt = new Date();
      const source = attribution({
        confidence: 0.86,
        fetchedAt: importedAt,
        label: 'Meeting notes import',
        source: 'meeting_notes_import',
        sourceUrl: null,
        providerMetadata: {
          accountId,
          companyName,
          characterCount: req.body.bodyMd.length,
        },
      });
      const extracted = extractMeetingNotes(req.body.bodyMd, companyName, source);
      const title =
        req.body.title?.trim() ||
        `Meeting notes — ${new Intl.DateTimeFormat('en-US', {
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        }).format(importedAt)}`;

      const persisted = await prisma.$transaction(async (tx) => {
        const note = await tx.note.create({
          data: {
            orgId: req.auth.orgId,
            accountId,
            companyId: req.body.companyId ?? null,
            authorUserId: req.auth.userId,
            title,
            bodyMd: req.body.bodyMd,
            pinned: true,
          },
          include: { author: { select: { email: true } } },
        });

        const created = {
          contacts: await persistContacts(tx, req.auth.orgId, companyName, extracted.contacts),
          risks: await persistRisks(tx, req.auth.orgId, companyName, extracted.risks),
          compliance: await persistCompliance(
            tx,
            req.auth.orgId,
            companyName,
            extracted.compliance,
          ),
          tasks: await persistTasks(tx, req.auth.orgId, extracted.tasks),
          techStackItems: extracted.techStack.reduce(
            (sum, category) => sum + category.items.length,
            0,
          ),
        };

        await persistMeetingTechStack(tx, {
          orgId: req.auth.orgId,
          accountId,
          companyName,
          domain: normalizeDomain(req.body.domain),
          noteId: note.id,
          source,
          techStack: extracted.techStack,
        });

        await tx.auditLog.create({
          data: {
            orgId: req.auth.orgId,
            userId: req.auth.userId,
            action: 'meeting_notes.import',
            targetType: 'note',
            targetId: note.id,
            diff: asJsonObject({
              accountId,
              companyName,
              created,
              extracted: {
                contacts: extracted.contacts.length,
                risks: extracted.risks.length,
                compliance: extracted.compliance.length,
                tasks: extracted.tasks.length,
                techStackCategories: extracted.techStack.length,
              },
            }),
          },
        });

        return { note, created };
      });

      return reply.code(201).send({
        note: serializeNote(persisted.note),
        extracted,
        created: persisted.created,
      });
    },
  );

  // PATCH /api/notes/:id
  server.patch(
    '/notes/:id',
    {
      preHandler: [server.requirePermission('activities:write')],
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
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
        select: {
          id: true,
          accountId: true,
          companyId: true,
          title: true,
          bodyMd: true,
          pinned: true,
        },
      });
      if (!existing) throw server.httpErrors.notFound('Note not found');
      await ensureAccountVisible({
        orgId: req.auth.orgId,
        userId: req.auth.userId,
        accountId: existing.accountId,
        companyId: existing.companyId,
      });

      const updated = await prisma.$transaction(async (tx) => {
        const updateResult = await tx.note.updateMany({
          where: { id: existing.id, orgId: req.auth.orgId, deletedAt: null },
          data: {
            ...(req.body.title !== undefined ? { title: req.body.title } : {}),
            ...(req.body.bodyMd !== undefined ? { bodyMd: req.body.bodyMd } : {}),
            ...(req.body.pinned !== undefined ? { pinned: req.body.pinned } : {}),
          },
        });
        if (updateResult.count === 0) {
          throw server.httpErrors.notFound('Note not found');
        }
        await tx.auditLog.create({
          data: {
            orgId: req.auth.orgId,
            userId: req.auth.userId,
            action: 'note.update',
            targetType: 'note',
            targetId: existing.id,
            diff: {
              before: {
                title: existing.title,
                bodyMd: existing.bodyMd,
                pinned: existing.pinned,
              },
              after: {
                ...(req.body.title !== undefined ? { title: req.body.title } : {}),
                ...(req.body.bodyMd !== undefined ? { bodyMd: req.body.bodyMd } : {}),
                ...(req.body.pinned !== undefined ? { pinned: req.body.pinned } : {}),
              },
            },
          },
        });
        return tx.note.findFirstOrThrow({
          where: { id: existing.id, orgId: req.auth.orgId, deletedAt: null },
          include: { author: { select: { email: true } } },
        });
      });
      return serializeNote(updated);
    },
  );

  // DELETE /api/notes/:id
  server.delete(
    '/notes/:id',
    {
      preHandler: [server.requirePermission('activities:write')],
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 204: z.null() },
      },
    },
    async (req, reply) => {
      const existing = await prisma.note.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
        select: { id: true, accountId: true, companyId: true, title: true, bodyMd: true },
      });
      if (!existing) throw server.httpErrors.notFound('Note not found');
      await ensureAccountVisible({
        orgId: req.auth.orgId,
        userId: req.auth.userId,
        accountId: existing.accountId,
        companyId: existing.companyId,
      });

      await prisma.$transaction(async (tx) => {
        const updateResult = await tx.note.updateMany({
          where: { id: existing.id, orgId: req.auth.orgId, deletedAt: null },
          data: { deletedAt: new Date() },
        });
        if (updateResult.count === 0) {
          throw server.httpErrors.notFound('Note not found');
        }
        await tx.auditLog.create({
          data: {
            orgId: req.auth.orgId,
            userId: req.auth.userId,
            action: 'note.delete',
            targetType: 'note',
            targetId: existing.id,
            diff: { title: existing.title, bodyMd: existing.bodyMd },
          },
        });
      });
      return reply.code(204).send(null);
    },
  );
};

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma } from '@bidstack/db';
import { Comment, CommentCreate, Mention, UserPresence, PresenceUpdate } from '@bidstack/shared';

export const collaborationRoutes: FastifyPluginAsyncZod = async (server) => {
  // GET /api/comments
  server.get(
    '/comments',
    {
      schema: {
        querystring: z.object({
          targetType: z.string().max(50),
          targetId: z.string().uuid(),
          limit: z.coerce.number().int().min(1).max(200).default(50),
        }),
        response: { 200: z.object({ items: z.array(Comment) }) },
      },
    },
    async (req) => {
      const rows = await prisma.comment.findMany({
        where: {
          orgId: req.auth.orgId,
          deletedAt: null,
          targetType: req.query.targetType,
          targetId: req.query.targetId,
        },
        include: { author: { select: { name: true } } },
        orderBy: { createdAt: 'asc' },
        take: req.query.limit,
      });
      return {
        items: rows.map((r) => ({
          id: r.id,
          orgId: r.orgId,
          targetType: r.targetType,
          targetId: r.targetId,
          authorUserId: r.authorUserId,
          authorName: r.author.name,
          bodyMd: r.bodyMd,
          parentId: r.parentId,
          resolvedAt: r.resolvedAt?.toISOString() ?? null,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
        })),
      };
    },
  );

  // POST /api/comments
  server.post(
    '/comments',
    {
      schema: {
        body: CommentCreate,
        response: { 201: Comment },
      },
    },
    async (req, reply) => {
      const created = await prisma.$transaction(async (tx) => {
        const comment = await tx.comment.create({
          data: {
            orgId: req.auth.orgId,
            targetType: req.body.targetType,
            targetId: req.body.targetId,
            authorUserId: req.auth.userId,
            bodyMd: req.body.bodyMd,
            parentId: req.body.parentId,
          },
          include: { author: { select: { name: true } } },
        });

        // Extract @mentions and create notifications
        const mentions = extractMentions(req.body.bodyMd);
        if (mentions.length) {
          const users = await tx.user.findMany({
            where: { orgId: req.auth.orgId, name: { in: mentions } },
            select: { id: true },
          });
          await tx.mention.createMany({
            data: users.map((u) => ({
              orgId: req.auth.orgId,
              commentId: comment.id,
              userId: u.id,
            })),
            skipDuplicates: true,
          });
        }

        return comment;
      });

      return reply.code(201).send({
        id: created.id,
        orgId: created.orgId,
        targetType: created.targetType,
        targetId: created.targetId,
        authorUserId: created.authorUserId,
        authorName: created.author.name,
        bodyMd: created.bodyMd,
        parentId: created.parentId,
        resolvedAt: created.resolvedAt?.toISOString() ?? null,
        createdAt: created.createdAt.toISOString(),
        updatedAt: created.updatedAt.toISOString(),
      });
    },
  );

  // DELETE /api/comments/:id
  server.delete(
    '/comments/:id',
    {
      schema: { params: z.object({ id: z.string().uuid() }), response: { 204: z.null() } },
    },
    async (req, reply) => {
      const existing = await prisma.comment.findFirst({
        where: {
          id: req.params.id,
          orgId: req.auth.orgId,
          authorUserId: req.auth.userId,
          deletedAt: null,
        },
      });
      if (!existing) throw server.httpErrors.notFound('Comment not found');
      await prisma.comment.update({ where: { id: existing.id }, data: { deletedAt: new Date() } });
      return reply.code(204).send(null);
    },
  );

  // GET /api/mentions
  server.get(
    '/mentions',
    {
      schema: {
        querystring: z.object({ unreadOnly: z.coerce.boolean().optional() }),
        response: { 200: z.object({ items: z.array(Mention) }) },
      },
    },
    async (req) => {
      const rows = await prisma.mention.findMany({
        where: {
          orgId: req.auth.orgId,
          userId: req.auth.userId,
          deletedAt: null,
          ...(req.query.unreadOnly ? { readAt: null } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
      return {
        items: rows.map((r) => ({
          id: r.id,
          orgId: r.orgId,
          commentId: r.commentId,
          userId: r.userId,
          readAt: r.readAt?.toISOString() ?? null,
          createdAt: r.createdAt.toISOString(),
        })),
      };
    },
  );

  // POST /api/mentions/:id/read
  server.post(
    '/mentions/:id/read',
    {
      schema: { params: z.object({ id: z.string().uuid() }), response: { 200: Mention } },
    },
    async (req) => {
      const updated = await prisma.mention.updateMany({
        where: { id: req.params.id, orgId: req.auth.orgId, userId: req.auth.userId },
        data: { readAt: new Date() },
      });
      if (updated.count === 0) throw server.httpErrors.notFound('Mention not found');
      const row = await prisma.mention.findFirstOrThrow({
        where: { id: req.params.id, orgId: req.auth.orgId, userId: req.auth.userId },
      });
      return {
        id: row.id,
        orgId: row.orgId,
        commentId: row.commentId,
        userId: row.userId,
        readAt: row.readAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      };
    },
  );

  // GET /api/presence
  server.get(
    '/presence',
    {
      schema: {
        querystring: z.object({
          recordType: z.string().optional(),
          recordId: z.string().uuid().optional(),
        }),
        response: { 200: z.object({ items: z.array(UserPresence) }) },
      },
    },
    async (req) => {
      const rows = await prisma.userPresence.findMany({
        where: {
          orgId: req.auth.orgId,
          status: { not: 'offline' },
          deletedAt: null,
          ...(req.query.recordType && req.query.recordId
            ? { currentRecordType: req.query.recordType, currentRecordId: req.query.recordId }
            : {}),
        },
        take: 50,
      });
      const userIds = rows.map((r) => r.userId);
      const users = await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true },
      });
      const userMap = new Map(users.map((u) => [u.id, u.name]));
      return {
        items: rows.map((r) => ({
          id: r.id,
          orgId: r.orgId,
          userId: r.userId,
          userName: userMap.get(r.userId) ?? null,
          status: r.status as z.infer<typeof UserPresence>['status'],
          currentRecordType: r.currentRecordType,
          currentRecordId: r.currentRecordId,
          lastSeenAt: r.lastSeenAt.toISOString(),
        })),
      };
    },
  );

  // POST /api/presence
  server.post(
    '/presence',
    {
      schema: {
        body: PresenceUpdate,
        response: { 200: UserPresence },
      },
    },
    async (req) => {
      const upserted = await prisma.userPresence.upsert({
        where: { userId: req.auth.userId },
        create: {
          orgId: req.auth.orgId,
          userId: req.auth.userId,
          status: req.body.status ?? 'online',
          currentRecordType: req.body.currentRecordType ?? null,
          currentRecordId: req.body.currentRecordId ?? null,
        },
        update: {
          orgId: req.auth.orgId,
          status: req.body.status ?? 'online',
          currentRecordType: req.body.currentRecordType ?? null,
          currentRecordId: req.body.currentRecordId ?? null,
          lastSeenAt: new Date(),
        },
      });
      const user = await prisma.user.findUnique({
        where: { id: upserted.userId },
        select: { name: true },
      });
      return {
        id: upserted.id,
        orgId: upserted.orgId,
        userId: upserted.userId,
        userName: user?.name ?? null,
        status: upserted.status as z.infer<typeof UserPresence>['status'],
        currentRecordType: upserted.currentRecordType,
        currentRecordId: upserted.currentRecordId,
        lastSeenAt: upserted.lastSeenAt.toISOString(),
      };
    },
  );
};

function extractMentions(body: string): string[] {
  const matches = body.match(/@([\w\s]+?)(?=\s|$|@)/g) ?? [];
  return matches.map((m) => m.slice(1).trim());
}

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma } from '@bidstack/db';
import {
  Comment,
  CommentCreate,
  Mention,
  MentionSummary,
  UserPresence,
  PresenceUpdate,
} from '@bidstack/shared';

import { cacheKey } from '../lib/redis-cache.js';

type MentionSummaryPayload = z.infer<typeof MentionSummary>;
type MentionSummaryCacheEntry = {
  expiresAt: number;
  promise: Promise<MentionSummaryPayload>;
};

const MENTION_SUMMARY_CACHE_TTL_MS = 15_000;
const mentionSummaryCache = new Map<string, MentionSummaryCacheEntry>();

function mentionSummaryCacheKey(orgId: string, userId: string): string {
  return `${orgId}:${userId}`;
}

function clearMentionSummaryCache(orgId: string, userId: string): void {
  mentionSummaryCache.delete(mentionSummaryCacheKey(orgId, userId));
}

async function buildMentionSummary(orgId: string, userId: string): Promise<MentionSummaryPayload> {
  const unread = await prisma.mention.count({
    where: {
      orgId,
      userId,
      readAt: null,
      deletedAt: null,
    },
  });
  return { unread };
}

async function cachedMentionSummary(orgId: string, userId: string): Promise<MentionSummaryPayload> {
  const key = mentionSummaryCacheKey(orgId, userId);
  const now = Date.now();
  const cached = mentionSummaryCache.get(key);
  if (cached && cached.expiresAt > now) return cached.promise;

  const promise = buildMentionSummary(orgId, userId);
  mentionSummaryCache.set(key, { expiresAt: now + MENTION_SUMMARY_CACHE_TTL_MS, promise });
  try {
    return await promise;
  } catch (err) {
    mentionSummaryCache.delete(key);
    throw err;
  }
}

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

        // Extract @mentions and create notifications. Candidates are the text
        // after each '@'; users match by the longest name-prefix so
        // "@John Smith please review" notifies the user named "John Smith".
        const candidates = extractMentionCandidates(req.body.bodyMd);
        if (candidates.length) {
          const prefixes = [...new Set(candidates.flatMap(mentionPrefixes))].slice(0, 50);
          const users = await tx.user.findMany({
            where: { orgId: req.auth.orgId, name: { in: prefixes, mode: 'insensitive' } },
            select: { id: true, name: true },
            // Cap so a 10k-char body with many @names can't cause a huge IN list
            take: 50,
          });
          const mentionedIds = resolveMentionedUserIds(candidates, users);
          if (mentionedIds.length) {
            await tx.mention.createMany({
              data: mentionedIds.map((userId) => ({
                orgId: req.auth.orgId,
                commentId: comment.id,
                userId,
              })),
              skipDuplicates: true,
            });
          }
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

  server.get(
    '/mentions/summary',
    {
      schema: {
        response: { 200: MentionSummary },
      },
    },
    async (req) => {
      return req.cache(() => cachedMentionSummary(req.auth.orgId, req.auth.userId), {
        ttlSeconds: 30,
        key: cacheKey([req.auth.orgId, 'mention-summary', req.auth.userId]),
      });
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
      clearMentionSummaryCache(req.auth.orgId, req.auth.userId);
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
      // BS-39: single query via explicit user relation in UserPresence schema —
      // avoids a second findMany + manual Map join.
      const rows = await prisma.userPresence.findMany({
        where: {
          orgId: req.auth.orgId,
          status: { not: 'offline' },
          deletedAt: null,
          ...(req.query.recordType && req.query.recordId
            ? { currentRecordType: req.query.recordType, currentRecordId: req.query.recordId }
            : {}),
        },
        include: { user: { select: { name: true } } },
        take: 50,
      });
      return {
        items: rows.map((r) => ({
          id: r.id,
          orgId: r.orgId,
          userId: r.userId,
          userName: r.user?.name ?? null,
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
      // WHY: userId is known before the upsert result — run user lookup in
      // parallel to cut two sequential DB round-trips to one.
      const [upserted, user] = await Promise.all([
        prisma.userPresence.upsert({
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
        }),
        prisma.user.findUnique({
          where: { id: req.auth.userId },
          select: { name: true },
        }),
      ]);
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

/** Text following each '@' (≤60 chars, stops at the next '@' or newline). */
function extractMentionCandidates(body: string): string[] {
  const out: string[] = [];
  const re = /@([^\s@][^@\n]{0,59})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null && out.length < 20) out.push(m[1]!);
  return out;
}

/** 1..4-word prefixes of a candidate, trailing punctuation stripped — these
 * are the only strings a user's full name could equal. */
function mentionPrefixes(candidate: string): string[] {
  const words = candidate
    .trim()
    .split(/\s+/)
    .slice(0, 4)
    .map((w) => w.replace(/[.,!?;:]+$/, ''));
  const prefixes: string[] = [];
  for (let i = 1; i <= words.length; i++) prefixes.push(words.slice(0, i).join(' '));
  return prefixes;
}

/** Longest-name-wins per candidate: "@John Smith" mentions the user named
 * "John Smith", not a different user named "John". */
function resolveMentionedUserIds(
  candidates: string[],
  users: Array<{ id: string; name: string | null }>,
): string[] {
  const ids = new Set<string>();
  for (const candidate of candidates) {
    const prefixSet = new Set(mentionPrefixes(candidate).map((p) => p.toLowerCase()));
    let best: { id: string; name: string } | null = null;
    for (const u of users) {
      if (!u.name || !prefixSet.has(u.name.toLowerCase())) continue;
      if (!best || u.name.length > best.name.length) best = { id: u.id, name: u.name };
    }
    if (best) ids.add(best.id);
  }
  return [...ids];
}

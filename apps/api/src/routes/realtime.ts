// Real-time REST routes:
//   POST   /entities/:type/:id/lock    — acquire edit lock (5 min TTL)
//   DELETE /entities/:type/:id/lock    — release edit lock
//   GET    /presence/org               — snapshot of online users (polling fallback)
//   GET    /presence/entity/:type/:id  — users viewing a specific entity

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '@bidstack/db';
import { getOrgPresence, getEntityPresence } from '../services/presence.service.js';
import { publish } from '../services/realtime.service.js';

const LOCK_TTL_MINUTES = 5;

const entityParamsSchema = z.object({
  type: z.string().regex(/^[a-z_]+$/, 'entityType must be lowercase letters/underscores'),
  id: z.string().uuid(),
});

const lockBodySchema = z.object({
  sessionId: z.string().min(1).max(128),
});

export const realtimeRoutes: FastifyPluginAsync = async (server) => {
  // ─── POST /entities/:type/:id/lock ──────────────────────────────────────
  server.post(
    '/entities/:type/:id/lock',
    {
      schema: {
        params: entityParamsSchema,
        body: lockBodySchema,
      },
    },
    async (req, reply) => {
      const { orgId, userId } = req.auth;
      const { type: entityType, id: entityId } = entityParamsSchema.parse(req.params);
      const { sessionId } = lockBodySchema.parse(req.body);

      const expiresAt = new Date(Date.now() + LOCK_TTL_MINUTES * 60 * 1_000);

      // Purge this org's expired locks first so a crash doesn't permanently
      // block editing. Scope to orgId so one tenant's cleanup can't touch
      // another's locks (the lock table is shared).
      await prisma.entityEditLock.deleteMany({
        where: { orgId, expiresAt: { lt: new Date() } },
      });

      // Check for an existing non-expired lock held by another user. Scoped to
      // orgId (findFirst, since the unique key is entityType+entityId only) so
      // a lock can never be read across tenants — defense-in-depth.
      const existing = await prisma.entityEditLock.findFirst({
        where: { orgId, entityType, entityId },
      });

      if (existing && existing.userId !== userId && existing.expiresAt > new Date()) {
        return reply.code(409).send({
          error: 'EDIT_LOCKED',
          lockedBy: existing.userId,
          expiresAt: existing.expiresAt.toISOString(),
        });
      }

      // Upsert the lock — idempotent for the same user (extends TTL).
      const lock = await prisma.entityEditLock.upsert({
        where: { entityType_entityId: { entityType, entityId } },
        create: { orgId, entityType, entityId, userId, sessionId, expiresAt },
        update: { userId, sessionId, expiresAt, acquiredAt: new Date() },
      });

      // Broadcast lock acquisition to entity channel.
      await publish(`entity:${entityType}:${entityId}:edits`, 'lock.acquired', {
        entityType,
        entityId,
        userId,
        sessionId,
        expiresAt: lock.expiresAt.toISOString(),
        orgId,
      });

      return reply.code(200).send({
        entityType,
        entityId,
        userId,
        sessionId,
        acquiredAt: lock.acquiredAt.toISOString(),
        expiresAt: lock.expiresAt.toISOString(),
      });
    },
  );

  // ─── DELETE /entities/:type/:id/lock ────────────────────────────────────
  server.delete(
    '/entities/:type/:id/lock',
    {
      schema: { params: entityParamsSchema },
    },
    async (req, reply) => {
      const { orgId, userId } = req.auth;
      const { type: entityType, id: entityId } = entityParamsSchema.parse(req.params);

      const existing = await prisma.entityEditLock.findFirst({
        where: { orgId, entityType, entityId },
      });

      if (!existing) {
        // Already released — idempotent success.
        return reply.code(204).send();
      }

      // Only the lock owner or an admin can release.
      if (existing.userId !== userId && req.auth.role !== 'admin') {
        return reply.code(403).send({ error: 'NOT_LOCK_OWNER' });
      }

      await prisma.entityEditLock.delete({
        where: { entityType_entityId: { entityType, entityId } },
      });

      // Broadcast lock release.
      await publish(`entity:${entityType}:${entityId}:edits`, 'lock.released', {
        entityType,
        entityId,
        userId,
        orgId,
      });

      return reply.code(204).send();
    },
  );

  // ─── GET /presence/org ─────────────────────────────────────────────────
  // Polling fallback when WebSocket is unavailable. Rate-limit callers in
  // the API rate-limit middleware (general 10k/min dev cap applies).
  server.get('/presence/org', async (req) => {
    const { orgId } = req.auth;
    const entries = await getOrgPresence(orgId);
    return { users: entries };
  });

  // ─── GET /presence/entity/:type/:id ────────────────────────────────────
  server.get(
    '/presence/entity/:type/:id',
    {
      schema: { params: entityParamsSchema },
    },
    async (req) => {
      const { orgId } = req.auth;
      const { type: entityType, id: entityId } = entityParamsSchema.parse(req.params);
      const entries = await getEntityPresence(orgId, entityType, entityId);
      return { users: entries };
    },
  );
};

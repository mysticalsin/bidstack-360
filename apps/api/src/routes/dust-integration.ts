// Dust integration management routes.
// Real sync logic lives in apps/worker; these routes return status and
// enqueue jobs. In v0.1 the queue is a stub if Redis is unreachable.

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { randomBytes, createHash } from 'node:crypto';
import { z } from 'zod';

import { prisma } from '@bidstack/db';

const DustStatus = z.object({
  workspace: z.string(),
  lastSyncAt: z.string().datetime().nullable(),
  nextSyncAt: z.string().datetime().nullable(),
  lastError: z.string().nullable(),
  pulled24h: z.number().int(),
  pushed24h: z.number().int(),
  agents: z.array(z.object({ id: z.string(), label: z.string() })),
});

const ApiKeySummary = z.object({
  id: z.string().uuid(),
  name: z.string(),
  prefix: z.string(),
  scopes: z.array(z.string()),
  lastUsedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});

export const dustRoutes: FastifyPluginAsyncZod = async (server) => {
  // GET /api/integrations/dust/status
  server.get(
    '/dust/status',
    { schema: { response: { 200: DustStatus } } },
    async (req) => {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const [pulled, pushed, lastErr] = await Promise.all([
        prisma.syncEvent.count({
          where: {
            orgId: req.auth.orgId,
            source: 'dust.poll',
            receivedAt: { gte: since },
          },
        }),
        prisma.syncEvent.count({
          where: {
            orgId: req.auth.orgId,
            source: 'dust.push',
            receivedAt: { gte: since },
          },
        }),
        prisma.syncEvent.findFirst({
          where: { orgId: req.auth.orgId, status: 'error' },
          orderBy: { receivedAt: 'desc' },
        }),
      ]);

      return {
        workspace: process.env.DUST_WORKSPACE_ID ?? 'mantu-presales',
        lastSyncAt: null,
        nextSyncAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        lastError: lastErr?.error ?? null,
        pulled24h: pulled,
        pushed24h: pushed,
        agents: [],
      };
    },
  );

  // POST /api/integrations/dust/resync
  server.post(
    '/dust/resync',
    {
      schema: {
        response: { 202: z.object({ jobId: z.string() }) },
      },
    },
    async (req, reply) => {
      // The actual BullMQ enqueue will be wired in apps/worker.
      // For v0.1 we synthesize a job id and log a sync_event so the UI gets
      // a feedback loop.
      const jobId = `manual-${Date.now()}`;
      await prisma.syncEvent.create({
        data: {
          orgId: req.auth.orgId,
          source: 'manual',
          eventType: 'dust.resync.requested',
          payload: { jobId },
          status: 'received',
        },
      });
      return reply.code(202).send({ jobId });
    },
  );

  // ─── API keys ────────────────────────────────────────────────────────
  server.get(
    '/api-keys',
    { schema: { response: { 200: z.object({ items: z.array(ApiKeySummary) }) } } },
    async (req) => {
      const keys = await prisma.apiKey.findMany({
        where: { orgId: req.auth.orgId, revokedAt: null },
        orderBy: { createdAt: 'desc' },
      });
      return {
        items: keys.map((k) => ({
          id: k.id,
          name: k.name,
          prefix: k.prefix,
          scopes: k.scopes,
          lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
          createdAt: k.createdAt.toISOString(),
        })),
      };
    },
  );

  server.post(
    '/api-keys',
    {
      schema: {
        body: z.object({
          name: z.string().min(1).max(80),
          scopes: z.array(z.enum(['read', 'write', 'mcp'])).min(1),
        }),
        response: {
          201: ApiKeySummary.extend({ secret: z.string() }),
        },
      },
    },
    async (req, reply) => {
      const raw = `bidstack_${randomBytes(28).toString('hex')}`;
      const prefix = raw.slice(0, 12);
      const hashedKey = createHash('sha256').update(raw).digest('hex');

      const created = await prisma.apiKey.create({
        data: {
          orgId: req.auth.orgId,
          name: req.body.name,
          hashedKey,
          prefix,
          scopes: req.body.scopes,
        },
      });

      return reply.code(201).send({
        id: created.id,
        name: created.name,
        prefix: created.prefix,
        scopes: created.scopes,
        lastUsedAt: null,
        createdAt: created.createdAt.toISOString(),
        secret: raw, // shown ONCE — caller must store
      });
    },
  );

  server.delete(
    '/api-keys/:id',
    { schema: { params: z.object({ id: z.string().uuid() }) } },
    async (req, reply) => {
      const key = await prisma.apiKey.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, revokedAt: null },
      });
      if (!key) throw server.httpErrors.notFound('API key not found');
      await prisma.apiKey.update({
        where: { id: key.id },
        data: { revokedAt: new Date() },
      });
      return reply.code(204).send();
    },
  );

  // GET /api/integrations/webhooks
  server.get(
    '/webhooks',
    {
      schema: {
        response: {
          200: z.object({
            items: z.array(
              z.object({
                id: z.string(),
                receivedAt: z.string().datetime(),
                source: z.string(),
                eventType: z.string(),
                status: z.string(),
                error: z.string().nullable(),
              }),
            ),
          }),
        },
      },
    },
    async (req) => {
      const events = await prisma.syncEvent.findMany({
        where: { orgId: req.auth.orgId },
        orderBy: { receivedAt: 'desc' },
        take: 50,
      });
      return {
        items: events.map((e) => ({
          id: e.id.toString(),
          receivedAt: e.receivedAt.toISOString(),
          source: e.source,
          eventType: e.eventType,
          status: e.status,
          error: e.error,
        })),
      };
    },
  );
};

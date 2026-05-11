// Dust integration management routes.
// Real sync logic lives in apps/worker; these routes return status and
// enqueue jobs. In v0.1 the queue is a stub if Redis is unreachable.

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';

import { prisma } from '@bidstack/db';
import { DustClient } from '@bidstack/dust-client';

import { enqueueDustResync } from '../queues/dust-poll.js';

interface DustAgentStatus {
  agents: Array<{ id: string; label: string; description: string | null }>;
  error: string | null;
}

// Fetch the Dust workspace's assistant agents. Returns an empty list in local
// stub mode, and captures provider errors as status metadata so the
// integrations page can fail loud without breaking the whole route.
async function listDustAgents(log: {
  warn: (a: object, msg?: string) => void;
}): Promise<DustAgentStatus> {
  const apiKey = process.env.DUST_API_KEY;
  const workspaceId = process.env.DUST_WORKSPACE_ID;
  if (!apiKey || !workspaceId) return { agents: [], error: null };
  try {
    const dust = new DustClient({
      apiKey,
      workspaceId,
      baseUrl: process.env.DUST_BASE_URL,
      timeoutMs: 5_000,
    });
    return { agents: await dust.listAgents(), error: null };
  } catch (err) {
    log.warn({ err }, 'dust agents fetch error');
    return {
      agents: [],
      error: err instanceof Error ? err.message : 'Dust agent list failed',
    };
  }
}

const DustStatus = z.object({
  workspace: z.string(),
  lastSyncAt: z.string().datetime().nullable(),
  nextSyncAt: z.string().datetime().nullable(),
  lastError: z.string().nullable(),
  pulled24h: z.number().int(),
  pushed24h: z.number().int(),
  configured: z.boolean(),
  agentsError: z.string().nullable(),
  agents: z.array(
    z.object({ id: z.string(), label: z.string(), description: z.string().nullable() }),
  ),
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
  server.get('/dust/status', { schema: { response: { 200: DustStatus } } }, async (req) => {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [pulled, pushed, lastErr, lastSync, agentStatus] = await Promise.all([
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
      prisma.syncEvent.findFirst({
        where: { orgId: req.auth.orgId, source: 'dust.poll', status: 'processed' },
        orderBy: { receivedAt: 'desc' },
      }),
      listDustAgents(req.log),
    ]);

    const configured = Boolean(process.env.DUST_API_KEY && process.env.DUST_WORKSPACE_ID);

    return {
      workspace: process.env.DUST_WORKSPACE_ID ?? 'mantu-presales',
      lastSyncAt:
        lastSync?.processedAt?.toISOString() ?? lastSync?.receivedAt.toISOString() ?? null,
      // Best-effort next tick: the dust-poll worker's repeat interval is 5m,
      // so we estimate from lastSync without coupling this route to BullMQ
      // scheduler internals.
      nextSyncAt: lastSync
        ? new Date(lastSync.receivedAt.getTime() + 5 * 60 * 1000).toISOString()
        : new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      lastError: lastErr?.error ?? null,
      pulled24h: pulled,
      pushed24h: pushed,
      configured,
      agentsError: agentStatus.error,
      agents: agentStatus.agents,
    };
  });

  // POST /api/integrations/dust/resync
  server.post(
    '/dust/resync',
    {
      schema: {
        response: { 202: z.object({ jobId: z.string() }) },
      },
    },
    async (req, reply) => {
      // Real enqueue into the dust-poll queue. The worker in apps/worker
      // consumes the same shape its scheduled tick uses, so a manual resync
      // runs the same code path as the cron-style poll. If Redis is
      // unreachable, the helper returns null. We still record the request as a
      // sync_event so the audit trail captures the attempt.
      const queuedId = await enqueueDustResync({ source: 'manual', orgId: req.auth.orgId });
      const jobId = queuedId ?? `manual-${Date.now()}`;
      await prisma.syncEvent.create({
        data: {
          orgId: req.auth.orgId,
          source: 'manual',
          eventType: 'dust.resync.requested',
          payload: { jobId, queued: queuedId !== null },
          status: queuedId ? 'received' : 'error',
          error: queuedId ? null : 'Redis unreachable; resync was not enqueued',
        },
      });
      if (!queuedId) {
        req.log.warn({ orgId: req.auth.orgId }, 'dust resync: Redis unreachable, no real job');
      }
      return reply.code(202).send({ jobId });
    },
  );

  // API keys
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
        secret: raw, // shown once; caller must store
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

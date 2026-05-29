// Dust integration management routes.
// Real sync logic lives in apps/worker; these routes return status and
// enqueue jobs. Schemas, helpers, and constants live in dust-integration.helpers.ts.

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';

import { prisma } from '@bidstack/db';
import type { Logger as PinoLogger } from 'pino';
import { DustClient } from '@bidstack/dust-client';

import { enqueueDustResync } from '../queues/dust-poll.js';
import {
  DustStatus,
  ApiKeySummary,
  IntegrationSetupGuide,
  IntegrationProbeBody,
  IntegrationProbeResult,
  DUST_STATUS_RATE_LIMIT_MAX,
  dustStatusCache,
  buildIntegrationSetupGuide,
  probeIntegrationEndpoint,
  cachedDustStatus,
  serializeOpportunityToMarkdown,
} from './dust-integration.helpers.js';

export const dustRoutes: FastifyPluginAsyncZod = async (server) => {
  // GET /api/integrations/setup-guide
  server.get(
    '/setup-guide',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      preHandler: server.requirePermission('integrations:read'),
      schema: { response: { 200: IntegrationSetupGuide } },
    },
    async () => buildIntegrationSetupGuide(),
  );

  // POST /api/integrations/probe
  server.post(
    '/probe',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      preHandler: server.requirePermission('integrations:write'),
      schema: {
        body: IntegrationProbeBody,
        response: { 200: IntegrationProbeResult },
      },
    },
    async (req) => {
      try {
        const result = await probeIntegrationEndpoint(req.body.kind, req.body.url);
        await prisma.auditLog.create({
          data: {
            orgId: req.auth.orgId,
            userId: req.auth.userId,
            action: 'integration.probe',
            targetType: 'integration_probe',
            diff: {
              kind: req.body.kind,
              checkedUrl: result.checkedUrl,
              ok: result.ok,
              status: result.status,
              latencyMs: result.latencyMs,
            },
          },
        });
        return result;
      } catch (err) {
        if (err instanceof Error) {
          throw server.httpErrors.badRequest(err.message);
        }
        throw err;
      }
    },
  );

  // POST /api/integrations/dust/push-deal/:id
  server.post(
    '/dust/push-deal/:id',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: z.object({ dustDocId: z.string() }) },
      },
    },
    async (req, _reply) => {
      const opp = await prisma.opportunity.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId },
      });
      if (!opp) throw server.httpErrors.notFound('Opportunity not found');

      const apiKey = process.env.DUST_API_KEY;
      const workspaceId = process.env.DUST_WORKSPACE_ID;
      const dataSourceId = process.env.DUST_DATA_SOURCE_ID;
      if (!apiKey || !workspaceId || !dataSourceId) {
        throw server.httpErrors.serviceUnavailable('Dust integration not configured');
      }

      const text = serializeOpportunityToMarkdown(opp);
      const documentId = `bidstack-deal-${opp.code}`;

      const dust = new DustClient({
        apiKey,
        workspaceId,
        baseUrl: process.env.DUST_BASE_URL,
        timeoutMs: 10_000,
        logger: req.log.child({ kind: 'dust' }) as unknown as PinoLogger,
      });

      const doc = await dust.upsertDocument(dataSourceId, documentId, text, {
        opportunity_code: opp.code,
        org_id: req.auth.orgId,
        source: 'bidstack',
        pushed_at: new Date().toISOString(),
      });

      await prisma.$transaction(async (tx) => {
        const updateResult = await tx.opportunity.updateMany({
          where: { id: opp.id, orgId: req.auth.orgId },
          data: { dustDocId: doc.document_id },
        });
        if (updateResult.count === 0) {
          throw server.httpErrors.notFound('Opportunity not found');
        }
        await tx.syncEvent.create({
          data: {
            orgId: req.auth.orgId,
            source: 'dust.push',
            eventType: 'deal.pushed',
            payload: { opportunityId: opp.id, dustDocId: doc.document_id, code: opp.code },
            status: 'processed',
            processedAt: new Date(),
          },
        });
        await tx.auditLog.create({
          data: {
            orgId: req.auth.orgId,
            userId: req.auth.userId,
            action: 'dust.push.deal',
            targetType: 'opportunity',
            targetId: opp.id,
            diff: { dustDocId: doc.document_id, code: opp.code },
          },
        });
      });

      return { dustDocId: doc.document_id };
    },
  );

  // GET /api/integrations/dust/status
  server.get(
    '/dust/status',
    {
      config: { rateLimit: { max: DUST_STATUS_RATE_LIMIT_MAX, timeWindow: '1 minute' } },
      schema: { response: { 200: DustStatus } },
    },
    async (req) => {
      return cachedDustStatus(req.auth.orgId, req.log);
    },
  );

  // POST /api/integrations/dust/resync
  server.post(
    '/dust/resync',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      preHandler: server.requirePermission('integrations:write'),
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
      dustStatusCache.delete(req.auth.orgId);
      if (!queuedId) {
        req.log.warn({ orgId: req.auth.orgId }, 'dust resync: Redis unreachable, no real job');
      }
      return reply.code(202).send({ jobId });
    },
  );

  // GET /api/integrations/api-keys
  server.get(
    '/api-keys',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      preHandler: server.requirePermission('integrations:read'),
      schema: { response: { 200: z.object({ items: z.array(ApiKeySummary) }) } },
    },
    async (req) => {
      const keys = await prisma.apiKey.findMany({
        where: { orgId: req.auth.orgId, revokedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 500,
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

  // POST /api/integrations/api-keys
  server.post(
    '/api-keys',
    {
      preHandler: server.requirePermission('integrations:write'),
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        body: z.object({
          name: z.string().min(1).max(80),
          scopes: z.array(z.enum(['read', 'write', 'mcp'])).min(1),
        }),
        response: {
          201: ApiKeySummary.extend({ secret: z.string(), warning: z.string().optional() }),
        },
      },
    },
    async (req, reply) => {
      const raw = `bidstack_${randomBytes(28).toString('hex')}`;
      const prefix = raw.slice(0, 12);
      const hashedKey = createHash('sha256').update(raw).digest('hex');

      const created = await prisma.$transaction(async (tx) => {
        const key = await tx.apiKey.create({
          data: {
            orgId: req.auth.orgId,
            name: req.body.name,
            hashedKey,
            prefix,
            scopes: req.body.scopes,
          },
        });
        await tx.auditLog.create({
          data: {
            orgId: req.auth.orgId,
            userId: req.auth.userId,
            action: 'apikey.create',
            targetType: 'api_key',
            targetId: key.id,
            diff: { name: req.body.name, scopes: req.body.scopes, prefix },
          },
        });
        return key;
      });

      return reply.code(201).send({
        id: created.id,
        name: created.name,
        prefix: created.prefix,
        scopes: created.scopes,
        lastUsedAt: null,
        createdAt: created.createdAt.toISOString(),
        secret: raw,
        warning: 'This secret will never be shown again. Store it securely.',
      });
    },
  );

  // DELETE /api/integrations/api-keys/:id
  server.delete(
    '/api-keys/:id',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      preHandler: server.requirePermission('integrations:write'),
      schema: { params: z.object({ id: z.string().uuid() }), response: { 204: z.null() } },
    },
    async (req, reply) => {
      const key = await prisma.apiKey.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, revokedAt: null },
      });
      if (!key) throw server.httpErrors.notFound('API key not found');
      await prisma.$transaction([
        prisma.apiKey.update({
          where: { id: key.id },
          data: { revokedAt: new Date() },
        }),
        prisma.auditLog.create({
          data: {
            orgId: req.auth.orgId,
            userId: req.auth.userId,
            action: 'apikey.revoke',
            targetType: 'api_key',
            targetId: key.id,
            diff: { name: key.name, prefix: key.prefix },
          },
        }),
      ]);
      return reply.code(204).send(null);
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

import { createHmac } from 'node:crypto';

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '@bidstack/db';

import { isPublicHostname } from '../lib/ssrf-guard.js';

const WebhookSub = z.object({
  id: z.string().uuid(),
  url: z.string(),
  events: z.array(z.string()),
  active: z.boolean(),
  failureCount: z.number().int(),
  lastDeliveryAt: z.string().datetime().nullable(),
  lastFailureAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});

const WebhookDeliveryRecord = z.object({
  id: z.string().uuid(),
  event: z.string(),
  statusCode: z.number().int().nullable(),
  success: z.boolean(),
  durationMs: z.number().int().nullable(),
  attempt: z.number().int(),
  errorMessage: z.string().nullable(),
  createdAt: z.string().datetime(),
});

/** Delivery timeout for test pings. */
const TEST_PING_TIMEOUT_MS = 10_000;

const WebhookSubCreate = z.object({
  url: z.string().url().max(500),
  events: z.array(z.string().min(1).max(100)).max(50).min(1),
  active: z.boolean().default(true),
});

const WebhookSubUpdate = z.object({
  url: z.string().url().max(500).optional(),
  events: z.array(z.string().min(1).max(100)).max(50).optional(),
  active: z.boolean().optional(),
});

function assertSafeWebhookUrl(rawUrl: string): void {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('url must be a valid URL');
  }
  if (url.protocol !== 'https:') {
    throw new Error('url must use HTTPS');
  }
  if (!isPublicHostname(url.hostname)) {
    throw new Error('url must not point to a private or internal address');
  }
}

export const webhookSubscriptionsRoutes: FastifyPluginAsyncZod = async (server) => {
  server.get(
    '/webhook-subscriptions',
    {
      schema: {
        response: { 200: z.array(WebhookSub) },
      },
    },
    async (req) => {
      const rows = await prisma.webhookSubscription.findMany({
        where: { orgId: req.auth.orgId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 500,
        select: {
          id: true,
          url: true,
          events: true,
          active: true,
          failureCount: true,
          lastDeliveryAt: true,
          lastFailureAt: true,
          createdAt: true,
        },
      });
      return rows.map((s) => ({
        id: s.id,
        url: s.url,
        events: s.events,
        active: s.active,
        failureCount: s.failureCount,
        lastDeliveryAt: s.lastDeliveryAt?.toISOString() ?? null,
        lastFailureAt: s.lastFailureAt?.toISOString() ?? null,
        createdAt: s.createdAt.toISOString(),
      }));
    },
  );

  server.post(
    '/webhook-subscriptions',
    {
      config: { rateLimit: { max: 15, timeWindow: '1 minute' } },
      preHandler: server.requirePermission('webhooks:write'),
      schema: {
        body: WebhookSubCreate,
        response: { 201: WebhookSub },
      },
    },
    async (req, reply) => {
      // SSRF defense: reject private/internal URLs.
      try {
        assertSafeWebhookUrl(req.body.url);
      } catch (err) {
        throw server.httpErrors.badRequest(err instanceof Error ? err.message : 'Invalid URL');
      }
      const secret = `whsec_${Buffer.from(crypto.randomUUID()).toString('base64url')}`;
      const created = await prisma.webhookSubscription.create({
        data: {
          orgId: req.auth.orgId,
          url: req.body.url,
          secret,
          events: req.body.events,
          active: req.body.active,
        },
      });
      return reply.code(201).send({
        id: created.id,
        url: created.url,
        events: created.events,
        active: created.active,
        failureCount: created.failureCount,
        lastDeliveryAt: null,
        lastFailureAt: null,
        createdAt: created.createdAt.toISOString(),
      });
    },
  );

  server.patch(
    '/webhook-subscriptions/:id',
    {
      preHandler: server.requirePermission('webhooks:write'),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: WebhookSubUpdate,
        response: { 200: WebhookSub },
      },
    },
    async (req) => {
      const existing = await prisma.webhookSubscription.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
      });
      if (!existing) throw server.httpErrors.notFound('Subscription not found');

      if (req.body.url !== undefined) {
        try {
          assertSafeWebhookUrl(req.body.url);
        } catch (err) {
          throw server.httpErrors.badRequest(err instanceof Error ? err.message : 'Invalid URL');
        }
      }

      const updated = await prisma.webhookSubscription.update({
        where: { id: existing.id },
        data: {
          ...(req.body.url !== undefined ? { url: req.body.url } : {}),
          ...(req.body.events !== undefined ? { events: req.body.events } : {}),
          ...(req.body.active !== undefined ? { active: req.body.active } : {}),
        },
      });
      return {
        id: updated.id,
        url: updated.url,
        events: updated.events,
        active: updated.active,
        failureCount: updated.failureCount,
        lastDeliveryAt: updated.lastDeliveryAt?.toISOString() ?? null,
        lastFailureAt: updated.lastFailureAt?.toISOString() ?? null,
        createdAt: updated.createdAt.toISOString(),
      };
    },
  );

  server.delete(
    '/webhook-subscriptions/:id',
    {
      preHandler: server.requirePermission('webhooks:write'),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 204: z.void() },
      },
    },
    async (req, reply) => {
      const existing = await prisma.webhookSubscription.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
      });
      if (!existing) throw server.httpErrors.notFound('Subscription not found');
      await prisma.webhookSubscription.update({
        where: { id: existing.id },
        data: { deletedAt: new Date() },
      });
      return reply.code(204).send();
    },
  );

  // ── Delivery history ──────────────────────────────────────────────────────

  server.get(
    '/webhook-subscriptions/:id/deliveries',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        querystring: z.object({
          limit: z.coerce.number().int().min(1).max(100).default(50),
          before: z.string().datetime().optional(),
        }),
        response: {
          200: z.object({
            data: z.array(WebhookDeliveryRecord),
            hasMore: z.boolean(),
          }),
        },
      },
    },
    async (req) => {
      const existing = await prisma.webhookSubscription.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
        select: { id: true },
      });
      if (!existing) throw server.httpErrors.notFound('Subscription not found');

      const limit = req.query.limit;
      const rows = await prisma.webhookDelivery.findMany({
        where: {
          subscriptionId: existing.id,
          ...(req.query.before ? { createdAt: { lt: new Date(req.query.before) } } : {}),
        },
        orderBy: { createdAt: 'desc' },
        // Fetch one extra to determine hasMore.
        take: limit + 1,
        select: {
          id: true,
          event: true,
          statusCode: true,
          success: true,
          durationMs: true,
          attempt: true,
          errorMessage: true,
          createdAt: true,
        },
      });

      const hasMore = rows.length > limit;
      const data = rows.slice(0, limit).map((r) => ({
        id: r.id,
        event: r.event,
        statusCode: r.statusCode,
        success: r.success,
        durationMs: r.durationMs,
        attempt: r.attempt,
        errorMessage: r.errorMessage,
        createdAt: r.createdAt.toISOString(),
      }));

      return { data, hasMore };
    },
  );

  // ── Test ping ─────────────────────────────────────────────────────────────

  server.post(
    '/webhook-subscriptions/:id/test',
    {
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
      preHandler: server.requirePermission('webhooks:write'),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: {
          200: z.object({
            success: z.boolean(),
            statusCode: z.number().int().nullable(),
            durationMs: z.number().int(),
            error: z.string().optional(),
          }),
        },
      },
    },
    async (req) => {
      const sub = await prisma.webhookSubscription.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
        select: { id: true, url: true, secret: true },
      });
      if (!sub) throw server.httpErrors.notFound('Subscription not found');

      const pingBody = JSON.stringify({
        id: crypto.randomUUID(),
        event: 'ping',
        orgId: req.auth.orgId,
        timestamp: new Date().toISOString(),
        data: { message: 'This is a test ping from BidStack webhooks.' },
      });

      const t = Math.floor(Date.now() / 1000);
      const sig = createHmac('sha256', sub.secret)
        .update(`${t}.${pingBody}`)
        .digest('hex');
      const signature = `t=${t},v1=${sig}`;
      const start = Date.now();

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), TEST_PING_TIMEOUT_MS);
        let res: Response;
        try {
          res = await fetch(sub.url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-BidStack-Signature': signature,
              'User-Agent': 'BidStack-Webhooks/1.0',
            },
            body: pingBody,
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeoutId);
        }
        return {
          success: res.status >= 200 && res.status < 300,
          statusCode: res.status,
          durationMs: Date.now() - start,
        };
      } catch (err) {
        return {
          success: false,
          statusCode: null,
          durationMs: Date.now() - start,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );
};

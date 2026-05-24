import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '@bidstack/db';

import { isPublicHostname } from '../lib/ssrf-guard.js';

const WebhookSub = z.object({
  id: z.string().uuid(),
  url: z.string(),
  events: z.array(z.string()),
  active: z.boolean(),
  createdAt: z.string().datetime(),
});

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
      });
      return rows.map((s) => ({
        id: s.id,
        url: s.url,
        events: s.events,
        active: s.active,
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
};

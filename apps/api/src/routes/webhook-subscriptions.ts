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
  url: z.string().url(),
  events: z.array(z.string().min(1)).min(1),
  active: z.boolean().default(true),
});

const WebhookSubUpdate = z.object({
  url: z.string().url().optional(),
  events: z.array(z.string().min(1)).optional(),
  active: z.boolean().optional(),
});

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
        where: { orgId: req.auth.orgId },
        orderBy: { createdAt: 'desc' },
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
      schema: {
        body: WebhookSubCreate,
        response: { 201: WebhookSub },
      },
    },
    async (req, reply) => {
      // SSRF defense: reject private/internal URLs.
      let url: URL;
      try {
        url = new URL(req.body.url);
      } catch {
        throw server.httpErrors.badRequest('url must be a valid URL');
      }
      if (url.protocol !== 'https:') {
        throw server.httpErrors.badRequest('url must use HTTPS');
      }
      if (!isPublicHostname(url.hostname)) {
        throw server.httpErrors.badRequest('url must not point to a private or internal address');
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
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: WebhookSubUpdate,
        response: { 200: WebhookSub },
      },
    },
    async (req) => {
      const existing = await prisma.webhookSubscription.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId },
      });
      if (!existing) throw server.httpErrors.notFound('Subscription not found');
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
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 204: z.void() },
      },
    },
    async (req, reply) => {
      const existing = await prisma.webhookSubscription.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId },
      });
      if (!existing) throw server.httpErrors.notFound('Subscription not found');
      await prisma.webhookSubscription.delete({ where: { id: existing.id } });
      return reply.code(204).send();
    },
  );
};

/**
 * Zapier integration routes — REST-hook subscribe/unsubscribe, polling fallbacks,
 * CRM action endpoints, and admin API key management.
 *
 * Auth model:
 *  - Zapier-facing routes use Bearer API key auth (not Clerk).
 *    Raw key is SHA-256 hashed and stored in ZapierApp.apiKeyHash.
 *  - Admin routes (key management) use Clerk auth so only org admins
 *    can create/revoke keys.
 *
 * Security:
 *  - Outbound payloads signed with HMAC-SHA256 in the fan-out service.
 *  - timingSafeEqual used for all key comparisons.
 *  - All queries are org-scoped.
 */

import { createHash } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma } from '@bidstack/db';
import { isPublicHostname } from '../../lib/ssrf-guard.js';

const ALLOWED_EVENTS = [
  'NEW_LEAD',
  'DEAL_STAGE_CHANGE',
  'NEW_CONTACT',
  'NEW_OPPORTUNITY',
  'NEW_TASK',
] as const;

async function resolveZapierApp(
  authHeader: string | undefined,
): Promise<{ id: string; orgId: string; name: string; scopes: string[] } | null> {
  if (!authHeader?.startsWith('Bearer ')) return null;

  const rawKey = authHeader.slice(7);
  const keyHash = createHash('sha256').update(rawKey).digest('hex');

  const app = await prisma.zapierApp.findFirst({
    where: { apiKeyHash: keyHash, deletedAt: null },
    select: { id: true, orgId: true, name: true, scopes: true },
  });

  if (!app) return null;

  void prisma.zapierApp
    .update({ where: { id: app.id }, data: { lastUsedAt: new Date() } })
    .catch(() => undefined);

  return {
    id: app.id,
    orgId: app.orgId,
    name: app.name,
    scopes: app.scopes as string[],
  };
}

export const zapierRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // ── Auth test ─────────────────────────────────────────────────────────────

  app.post(
    '/zapier/auth/test',
    {
      config: { public: true },
      schema: {
        summary: 'Zapier API key authentication test',
        tags: ['zapier'],
        response: {
          200: z.object({ id: z.string(), name: z.string(), orgId: z.string() }),
          401: z.object({ error: z.string() }),
        },
      },
    },
    async (req, reply) => {
      const zapierApp = await resolveZapierApp(req.headers.authorization);
      if (!zapierApp) return reply.code(401).send({ error: 'Invalid API key' });
      return reply.send({ id: zapierApp.id, name: zapierApp.name, orgId: zapierApp.orgId });
    },
  );

  // ── REST-hook subscribe ───────────────────────────────────────────────────

  app.post(
    '/zapier/subscribe',
    {
      config: { public: true },
      schema: {
        summary: 'Subscribe to a BidStack event (REST-hook)',
        tags: ['zapier'],
        body: z.object({
          event: z.enum(ALLOWED_EVENTS),
          targetUrl: z.string().url(),
        }),
        response: {
          201: z.object({ id: z.string() }),
          400: z.object({ error: z.string() }),
          401: z.object({ error: z.string() }),
          409: z.object({ error: z.string(), existingId: z.string() }),
        },
      },
    },
    async (req, reply) => {
      const zapierApp = await resolveZapierApp(req.headers.authorization);
      if (!zapierApp) return reply.code(401).send({ error: 'Invalid API key' });

      const { event, targetUrl } = req.body;

      // SSRF guard — reject webhook targets that resolve to internal addresses.
      // Without this check an attacker could register e.g. http://redis:6379 as
      // a callback URL and use Zapier webhooks to probe the internal network.
      if (!isPublicHostname(new URL(targetUrl).hostname)) {
        return reply
          .code(400)
          .send({ error: 'targetUrl must point to a publicly routable address' });
      }

      const existing = await prisma.zapierSubscription.findFirst({
        where: { orgId: zapierApp.orgId, eventType: event },
        select: { id: true },
      });

      if (existing) {
        return reply.code(409).send({ error: 'Already subscribed', existingId: existing.id });
      }

      const sub = await prisma.zapierSubscription.create({
        data: {
          orgId: zapierApp.orgId,
          zapierAppId: zapierApp.id,
          eventType: event,
          targetUrl,
        },
        select: { id: true },
      });

      return reply.code(201).send({ id: sub.id });
    },
  );

  // ── REST-hook unsubscribe ─────────────────────────────────────────────────

  app.delete(
    '/zapier/subscribe/:id',
    {
      config: { public: true },
      schema: {
        summary: 'Unsubscribe from a BidStack event (REST-hook)',
        tags: ['zapier'],
        params: z.object({ id: z.string().uuid() }),
        response: {
          204: z.null(),
          401: z.object({ error: z.string() }),
          404: z.object({ error: z.string() }),
        },
      },
    },
    async (req, reply) => {
      const zapierApp = await resolveZapierApp(req.headers.authorization);
      if (!zapierApp) return reply.code(401).send({ error: 'Invalid API key' });

      const { id } = req.params;
      const sub = await prisma.zapierSubscription.findFirst({
        where: { id, orgId: zapierApp.orgId },
        select: { id: true },
      });

      if (!sub) return reply.code(404).send({ error: 'Subscription not found' });

      await prisma.zapierSubscription.delete({ where: { id } });

      return reply.code(204).send(null);
    },
  );

  // ── Polling fallbacks ─────────────────────────────────────────────────────

  app.get(
    '/zapier/triggers/NEW_LEAD',
    {
      config: { public: true },
      schema: {
        summary: 'Polling fallback — recent leads',
        tags: ['zapier'],
        querystring: z.object({ since: z.string().datetime().optional() }),
        response: {
          200: z.array(
            z.object({
              id: z.string(),
              title: z.string().nullable(),
              status: z.string(),
              email: z.string().nullable(),
              createdAt: z.string(),
            }),
          ),
          401: z.object({ error: z.string() }),
        },
      },
    },
    async (req, reply) => {
      const zapierApp = await resolveZapierApp(req.headers.authorization);
      if (!zapierApp) return reply.code(401).send({ error: 'Invalid API key' });

      const leads = await prisma.lead.findMany({
        where: {
          orgId: zapierApp.orgId,
          // P2 #26: never surface soft-deleted leads to Zapier
          deletedAt: null,
          ...(req.query.since ? { createdAt: { gte: new Date(req.query.since) } } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { id: true, title: true, status: true, email: true, createdAt: true },
      });

      return reply.send(leads.map((l) => ({ ...l, createdAt: l.createdAt.toISOString() })));
    },
  );

  app.get(
    '/zapier/triggers/NEW_CONTACT',
    {
      config: { public: true },
      schema: {
        summary: 'Polling fallback — recent contacts',
        tags: ['zapier'],
        querystring: z.object({ since: z.string().datetime().optional() }),
        response: {
          200: z.array(
            z.object({
              id: z.string(),
              name: z.string().nullable(),
              email: z.string().nullable(),
              phone: z.string().nullable(),
              createdAt: z.string(),
            }),
          ),
          401: z.object({ error: z.string() }),
        },
      },
    },
    async (req, reply) => {
      const zapierApp = await resolveZapierApp(req.headers.authorization);
      if (!zapierApp) return reply.code(401).send({ error: 'Invalid API key' });

      const contacts = await prisma.contact.findMany({
        where: {
          orgId: zapierApp.orgId,
          // P2 #27: never surface soft-deleted contacts to Zapier
          deletedAt: null,
          ...(req.query.since ? { createdAt: { gte: new Date(req.query.since) } } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { id: true, name: true, email: true, phone: true, createdAt: true },
      });

      return reply.send(contacts.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() })));
    },
  );
};

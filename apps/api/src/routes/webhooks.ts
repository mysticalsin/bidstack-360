// Inbound webhooks. /webhooks/dust verifies HMAC, dedups via Redis (or
// in-process Map fallback in dev), persists to sync_events, and acks <50ms.
//
// The actual side-effect work runs in apps/worker; this route is just the
// receiver.

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '@bidstack/db';
import { verifyDustSignature } from '@bidstack/dust-client';

// In-memory dedup for dev (7-day TTL would use Redis in prod).
const seen = new Map<string, number>();
const DEDUP_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function rememberOrReject(eventId: string): boolean {
  const now = Date.now();
  for (const [k, expiry] of seen) {
    if (expiry < now) seen.delete(k);
  }
  if (seen.has(eventId)) return false;
  seen.set(eventId, now + DEDUP_TTL_MS);
  return true;
}

export const webhooksRoutes: FastifyPluginAsyncZod = async (server) => {
  // Capture raw body for HMAC verification.
  server.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (req, body, done) => {
      try {
        const json = body.length ? JSON.parse(body as string) : {};
        (req as unknown as { rawBody: string }).rawBody = body as string;
        done(null, json);
      } catch (err) {
        done(err as Error);
      }
    },
  );

  server.post(
    '/webhooks/dust',
    {
      config: { public: true },
      schema: {
        body: z.record(z.unknown()),
        response: { 200: z.object({ ok: z.literal(true) }) },
      },
    },
    async (req, reply) => {
      const secret = process.env.DUST_WEBHOOK_SECRET;
      if (!secret) {
        req.log.warn('webhook dropped — DUST_WEBHOOK_SECRET unset');
        // 503 is the right status, but we constrain the response schema to 200
        // for the success case. Throw a sensible 503 instead so the framework
        // serializes the right shape and our schema stays honest.
        throw server.httpErrors.serviceUnavailable('DUST_WEBHOOK_SECRET not configured');
      }

      const sig = req.headers['x-dust-signature'];
      const eventType = req.headers['x-dust-event'];
      const eventId = req.headers['x-dust-event-id'];
      const orgIdHeader = req.headers['x-bidstack-org'];

      const rawBody = (req as unknown as { rawBody: string }).rawBody ?? '';
      const ok = await verifyDustSignature(
        rawBody,
        Array.isArray(sig) ? (sig[0] ?? null) : (sig ?? null),
        secret,
      );
      if (!ok) {
        req.log.warn({ eventType }, 'webhook signature mismatch');
        throw server.httpErrors.unauthorized('Invalid signature');
      }

      const eid = String(Array.isArray(eventId) ? eventId[0] : eventId ?? '');
      if (eid && !rememberOrReject(eid)) {
        req.log.info({ eid }, 'webhook duplicate dropped');
        return { ok: true as const };
      }

      // Org resolution: in v0.1 we trust an x-bidstack-org header (single-tenant
      // dev). Production will derive orgId from the API key bound to the
      // webhook subscription.
      const org = await prisma.org.findFirst({
        where: orgIdHeader
          ? { id: String(orgIdHeader) }
          : { clerkOrg: 'org_seed_mantu' },
      });
      if (!org) throw server.httpErrors.notFound('Org not found for webhook');

      await prisma.syncEvent.create({
        data: {
          orgId: org.id,
          source: 'dust.webhook',
          eventType: String(Array.isArray(eventType) ? eventType[0] : eventType ?? 'unknown'),
          payload: req.body as object,
          status: 'received',
        },
      });

      // Worker will process. We ack fast.
      return { ok: true as const };
    },
  );
};

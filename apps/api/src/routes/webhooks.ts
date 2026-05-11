// Inbound webhooks. /webhooks/dust verifies HMAC, dedups via Redis (or
// in-process Map fallback in dev), persists to sync_events, and acks <50ms.
//
// The actual side-effect work runs in apps/worker; this route is just the
// receiver.

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '@bidstack/db';
import { verifyDustSignature } from '@bidstack/dust-client';

import { redis } from '../redis.js';

// Webhook dedup. Redis is authoritative — `SET key 1 EX 7d NX` is the
// atomic check-and-set. If Redis is unreachable we fall back to an in-memory
// Map so dev still works, but the fallback is logged at warn level because
// a clustered deploy without Redis can re-process Dust retries.
const DEDUP_TTL_SECONDS = 7 * 24 * 60 * 60;
const fallbackSeen = new Map<string, number>();
const FALLBACK_TTL_MS = DEDUP_TTL_SECONDS * 1000;

async function rememberOrReject(
  eventId: string,
  log: { warn: (a: object, msg?: string) => void },
): Promise<boolean> {
  // Try Redis NX first — the only durable option across replicas + restarts.
  try {
    const setResult = await redis.set(`dedup:dust:${eventId}`, '1', 'EX', DEDUP_TTL_SECONDS, 'NX');
    return setResult === 'OK';
  } catch (err) {
    log.warn({ err }, 'webhook dedup: Redis unreachable, using process-local fallback');
    // Fallback: per-process Map. Sweeps expired entries on each call so we
    // don't leak memory if Redis stays down for hours.
    const now = Date.now();
    for (const [k, expiry] of fallbackSeen) {
      if (expiry < now) fallbackSeen.delete(k);
    }
    if (fallbackSeen.has(eventId)) return false;
    fallbackSeen.set(eventId, now + FALLBACK_TTL_MS);
    return true;
  }
}

export const webhooksRoutes: FastifyPluginAsyncZod = async (server) => {
  // Capture raw body for HMAC verification.
  server.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    try {
      const json = body.length ? JSON.parse(body as string) : {};
      (req as unknown as { rawBody: string }).rawBody = body as string;
      done(null, json);
    } catch (err) {
      done(err as Error);
    }
  });

  server.post(
    '/webhooks/dust',
    {
      config: { public: true },
      schema: {
        body: z.record(z.unknown()),
        response: { 200: z.object({ ok: z.literal(true) }) },
      },
    },
    async (req, _reply) => {
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

      const eid = String(Array.isArray(eventId) ? eventId[0] : (eventId ?? ''));
      if (eid && !(await rememberOrReject(eid, req.log))) {
        req.log.info({ eid }, 'webhook duplicate dropped');
        return { ok: true as const };
      }

      // Org resolution: derive from the WebhookSubscription whose secret
      // matches DUST_WEBHOOK_SECRET. Never trust client-supplied headers
      // (audit P1.3: x-bidstack-org spoofing). In dev with no subscription
      // row, fall back to the seed org so local development stays smooth.
      const subscription = await prisma.webhookSubscription.findFirst({
        where: { secret, active: true },
      });
      const org = subscription
        ? await prisma.org.findUnique({ where: { id: subscription.orgId } })
        : await prisma.org.findUnique({ where: { clerkOrg: 'org_seed_mantu' } });
      if (!org) throw server.httpErrors.notFound('Org not found for webhook subscription');

      await prisma.syncEvent.create({
        data: {
          orgId: org.id,
          source: 'dust.webhook',
          eventType: String(Array.isArray(eventType) ? eventType[0] : (eventType ?? 'unknown')),
          payload: req.body as object,
          status: 'received',
        },
      });

      // Worker will process. We ack fast.
      return { ok: true as const };
    },
  );
};

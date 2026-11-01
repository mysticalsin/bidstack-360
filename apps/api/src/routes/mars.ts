// MARS integration routes (feature flag MARS_INTEGRATION_ENABLED, off by
// default: every route answers 404 while it is off).
//
//   GET  /mars/status                  meetings:read   connection status and counts
//   POST /mars/sync                    meetings:write + Admin   create the org connection if missing, enqueue a pull
//   POST /mars/webhook                 public, HMAC    MARS nudges Polo; Polo then pulls (no payload trusted)
//   GET  /mars/tools                   meetings:read   MCP style tools/list (read-only tools)
//   POST /mars/tools/:name             meetings:read   MCP style tools/call {arguments}
//
// Secrets (MARS_WEBHOOK_SECRET, client credentials) are env only and never
// returned or logged. Design: fleet/polo-mars-integration.md.
import { createHmac, timingSafeEqual } from 'node:crypto';

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

import { type Prisma, prisma } from '@bidstack/db';
import { isMarsEnabled, MarsWebhookEvent } from '@bidstack/shared';

import { userHasAnyRole } from '../lib/rbac-decision-cache.js';
import { callMarsTool, listMarsTools, MarsToolError } from '../mars/tools.js';
import { enqueueMeetingIntel } from '../queues/meeting-intel.js';

const WEBHOOK_SKEW_MS = 5 * 60_000;

export function verifyMarsSignature(rawBody: string, timestamp: string | undefined, signature: string | undefined, secret: string, now = Date.now()): boolean {
  if (!timestamp || !signature || !/^\d{10,13}$/.test(timestamp)) return false;
  const ts = timestamp.length === 13 ? Number(timestamp) : Number(timestamp) * 1000;
  if (Math.abs(now - ts) > WEBHOOK_SKEW_MS) return false;
  const want = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  const got = signature.replace(/^sha256=/, '');
  if (!/^[a-f0-9]{64}$/.test(got)) return false;
  return timingSafeEqual(Buffer.from(want, 'hex'), Buffer.from(got, 'hex'));
}

async function audit(req: FastifyRequest, action: string, targetId: string | null, diff: Record<string, unknown>, actor?: { orgId: string; userId: string | null }) {
  await prisma.auditLog.create({
    data: { orgId: actor?.orgId ?? req.auth.orgId, userId: actor ? actor.userId : req.auth.userId, action, targetType: 'meeting_intel', targetId, diff: diff as Prisma.InputJsonValue },
  });
}

export const marsRoutes: FastifyPluginAsyncZod = async (server) => {
  const enabled = () => isMarsEnabled(process.env.MARS_INTEGRATION_ENABLED);
  server.addHook('onRequest', async () => {
    if (!enabled()) throw server.httpErrors.notFound('Not found');
  });
  // Raw body for the webhook HMAC (parser scope = this plugin only).
  server.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    try {
      const text = body as string;
      (req as unknown as { rawBody: string }).rawBody = text;
      done(null, text.length ? JSON.parse(text) : {});
    } catch (err) {
      done(err as Error);
    }
  });

  server.get('/mars/status', { config: { permission: 'meetings:read' } }, async (req) => {
    const orgId = req.auth.orgId;
    const conn = await prisma.meetingSourceConnection.findFirst({ where: { orgId, source: 'mars' }, orderBy: { createdAt: 'asc' } });
    const [pending, unmatched] = conn
      ? await Promise.all([
          prisma.meetingIngestItem.count({ where: { orgId, connectionId: conn.id, status: 'pending' } }),
          prisma.meetingIngestItem.count({ where: { orgId, connectionId: conn.id, status: 'unmatched' } }),
        ])
      : [0, 0];
    return {
      source: 'mars',
      scope: 'org',
      status: !conn ? 'not_connected' : conn.lastError === 'not_configured' ? 'not_configured' : conn.lastError ? 'error' : conn.status,
      lastSyncAt: conn?.lastSyncAt?.toISOString() ?? null,
      lastError: conn?.lastError ?? null,
      itemsReceived: conn?.itemsReceived ?? 0,
      pending,
      unmatched,
      webhook: !!process.env.MARS_WEBHOOK_SECRET,
    };
  });

  server.post(
    '/mars/sync',
    { config: { permission: 'meetings:write' }, schema: { response: { 202: z.object({ connectionId: z.string().uuid(), queued: z.boolean() }) } } },
    async (req, reply) => {
      const { orgId, userId } = req.auth;
      if (!(await userHasAnyRole(orgId, userId, ['Admin']))) throw server.httpErrors.forbidden('Admin only');
      const conn =
        (await prisma.meetingSourceConnection.findFirst({ where: { orgId, source: 'mars' }, orderBy: { createdAt: 'asc' } })) ??
        (await prisma.meetingSourceConnection.create({ data: { orgId, userId, source: 'mars', consentedAt: new Date() } }));
      if (conn.status !== 'connected') throw server.httpErrors.conflict('MARS source is not connected');
      const queued = (await enqueueMeetingIntel({ kind: 'mars-sync', orgId, reason: 'manual' })) !== null;
      await audit(req, 'meeting_intel.source.sync', conn.id, { source: 'mars', queued });
      return reply.code(202).send({ connectionId: conn.id, queued });
    },
  );

  server.post(
    '/mars/webhook',
    { config: { public: true, rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const secret = process.env.MARS_WEBHOOK_SECRET;
      const orgId = process.env.MARS_ORG_ID;
      if (!secret || !orgId) throw server.httpErrors.notFound('Not found');
      const raw = (req as unknown as { rawBody?: string }).rawBody ?? '';
      const ts = req.headers['x-mars-timestamp'];
      const sig = req.headers['x-mars-signature'];
      if (!verifyMarsSignature(raw, typeof ts === 'string' ? ts : undefined, typeof sig === 'string' ? sig : undefined, secret)) {
        throw server.httpErrors.unauthorized('Invalid signature');
      }
      const evt = MarsWebhookEvent.safeParse(req.body);
      if (!evt.success) throw server.httpErrors.badRequest('Invalid event');
      const conn = await prisma.meetingSourceConnection.findFirst({ where: { orgId, source: 'mars', status: 'connected' }, select: { id: true } });
      if (!conn) return reply.code(202).send({ queued: false });
      // The event is only a nudge: the worker pulls from MARS, so a forged or replayed body cannot inject data.
      const queued = (await enqueueMeetingIntel({ kind: 'mars-sync', orgId, reason: 'webhook' })) !== null;
      await audit(req, 'meeting_intel.source.webhook', conn.id, { source: 'mars', type: evt.data.type, queued }, { orgId, userId: null });
      return reply.code(202).send({ queued });
    },
  );

  server.get('/mars/tools', { config: { permission: 'meetings:read' } }, async () => ({ tools: listMarsTools() }));

  server.post(
    '/mars/tools/:name',
    {
      config: { permission: 'meetings:read', rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: { params: z.object({ name: z.string().min(1).max(40) }), body: z.object({ arguments: z.record(z.unknown()).default({}) }) },
    },
    async (req) => {
      try {
        const result = await callMarsTool({ orgId: req.auth.orgId, userId: req.auth.userId }, req.params.name, req.body.arguments);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result, isError: false };
      } catch (err) {
        if (err instanceof MarsToolError) {
          if (err.code === 'not_found') throw server.httpErrors.notFound(err.message);
          if (err.code === 'forbidden') throw server.httpErrors.forbidden(err.message);
          throw server.httpErrors.badRequest(err.message);
        }
        throw err;
      }
    },
  );
};

/**
 * Webhook message log (factory slice 4).
 *
 * A message is one event sent to one endpoint; each try is a WebhookDelivery
 * row linked by messageId. The worker stores request headers with every HMAC
 * masked and response bodies redacted and capped, and this route redacts again
 * on read so older rows or a missed pattern never reach the browser.
 *
 * Replay writes a targeted row to webhook_outbox (subscription_id, replay_of_id)
 * keyed by the caller's request id, so a double click enqueues once. The worker
 * relay sends it to that one endpoint as a new message linked to the original.
 */
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { Prisma, prisma, recordWebhookOutboxEvent } from '@bidstack/db';
import {
  WEBHOOK_MESSAGE_STATUSES,
  capWebhookText,
  maskWebhookSignature,
  redactWebhookText,
} from '@bidstack/shared';

import { decodeWebhookMessageCursor, encodeWebhookMessageCursor } from './webhook-message-cursor.js';

const MessageRow = z.object({
  id: z.string().uuid(),
  subscriptionId: z.string().uuid(),
  url: z.string(),
  event: z.string(),
  status: z.enum(WEBHOOK_MESSAGE_STATUSES),
  attempts: z.number().int(),
  lastStatusCode: z.number().int().nullable(),
  lastDurationMs: z.number().int().nullable(),
  replayOfId: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
});

const AttemptRow = z.object({
  id: z.string().uuid(),
  attempt: z.number().int(),
  statusCode: z.number().int().nullable(),
  success: z.boolean(),
  durationMs: z.number().int().nullable(),
  errorMessage: z.string().nullable(),
  requestHeaders: z.record(z.string()),
  responseBody: z.string().nullable(),
  responseTruncated: z.boolean(),
  createdAt: z.string().datetime(),
});

const ListQuery = z.object({
  subscriptionId: z.string().uuid().optional(),
  event: z.string().max(100).optional(),
  status: z.enum(WEBHOOK_MESSAGE_STATUSES).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const STATS_WINDOWS = { '24h': 24, '7d': 24 * 7, '30d': 24 * 30 } as const;
const LATENCY_SAMPLE_CAP = 2000;


function safeHeaders(raw: Prisma.JsonValue | null): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v !== 'string') continue;
    out[k] = /signature/i.test(k) ? maskWebhookSignature(v) : redactWebhookText(v);
  }
  return out;
}

function safeBody(raw: string | null): { text: string | null; truncated: boolean } {
  if (raw === null) return { text: null, truncated: false };
  return capWebhookText(redactWebhookText(raw));
}

async function requireHumanReplay(req: FastifyRequest): Promise<void> {
  if (req.auth.role === 'api' || req.auth.userId.startsWith('apikey:')) {
    throw req.server.httpErrors.forbidden('Webhook replay requires a user session');
  }
}

export const webhookMessagesRoutes: FastifyPluginAsyncZod = async (server) => {
  server.get(
    '/webhook-messages',
    {
      preHandler: server.requirePermission('webhooks:read'),
      schema: {
        querystring: ListQuery,
        response: { 200: z.object({ items: z.array(MessageRow), nextCursor: z.string().nullable() }) },
      },
    },
    async (req) => {
      const q = req.query;
      const cursor = q.cursor ? decodeWebhookMessageCursor(q.cursor) : null;
      if (q.cursor && !cursor) throw server.httpErrors.badRequest('Invalid cursor');
      const filters: Prisma.Sql[] = [Prisma.sql`org_id = ${req.auth.orgId}::uuid`];
      if (q.subscriptionId) filters.push(Prisma.sql`subscription_id = ${q.subscriptionId}::uuid`);
      if (q.event) filters.push(Prisma.sql`event = ${q.event}`);
      if (q.status) filters.push(Prisma.sql`status::text = ${q.status}`);
      if (q.from) filters.push(Prisma.sql`created_at >= ${new Date(q.from)}`);
      if (q.to) filters.push(Prisma.sql`created_at <= ${new Date(q.to)}`);
      if (cursor) {
        // Bind the cursor text. Casting it in SQL keeps microseconds that a Date would drop.
        filters.push(Prisma.sql`(
          created_at < ${cursor.createdAt}::timestamptz
          OR (created_at = ${cursor.createdAt}::timestamptz AND id < ${cursor.id}::uuid)
        )`);
      }
      const ordered = await prisma.$queryRaw<Array<{ id: string; created_at_text: string }>>`
        SELECT id,
               to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_text
        FROM webhook_messages
        WHERE ${Prisma.join(filters, ' AND ')}
        ORDER BY created_at DESC, id DESC
        LIMIT ${q.limit + 1}
      `;
      const found = ordered.length
        ? await prisma.webhookMessage.findMany({
            where: { orgId: req.auth.orgId, id: { in: ordered.map((row) => row.id) } },
            take: ordered.length,
            include: { subscription: { select: { url: true } } },
          })
        : [];
      const byId = new Map(found.map((row) => [row.id, row]));
      const rows = ordered.flatMap((row) => {
        const message = byId.get(row.id);
        return message ? [{ message, createdAtText: row.created_at_text }] : [];
      });
      const page = rows.slice(0, q.limit);
      const last = page.at(-1);
      return {
        items: page.map(({ message: m }) => ({
          id: m.id,
          subscriptionId: m.subscriptionId,
          url: m.subscription.url,
          event: m.event,
          status: m.status,
          attempts: m.attempts,
          lastStatusCode: m.lastStatusCode,
          lastDurationMs: m.lastDurationMs,
          replayOfId: m.replayOfId,
          createdAt: m.createdAt.toISOString(),
        })),
        nextCursor:
          ordered.length > q.limit && last
            ? encodeWebhookMessageCursor(last.createdAtText, last.message.id)
            : null,
      };
    },
  );

  server.get(
    '/webhook-messages/:id',
    {
      preHandler: server.requirePermission('webhooks:read'),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: {
          200: z.object({
            message: MessageRow,
            requestBody: z.string(),
            requestBodyTruncated: z.boolean(),
            attempts: z.array(AttemptRow),
          }),
        },
      },
    },
    async (req) => {
      const m = await prisma.webhookMessage.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId },
        include: {
          subscription: { select: { url: true } },
          deliveries: { orderBy: [{ attempt: 'asc' }, { createdAt: 'asc' }], take: 50 },
        },
      });
      if (!m) throw server.httpErrors.notFound('Message not found');
      const envelope = JSON.stringify({
        id: m.id,
        event: m.event,
        orgId: m.orgId,
        timestamp: m.eventTimestamp.toISOString(),
        data: m.payload,
      });
      const request = safeBody(envelope);
      return {
        message: {
          id: m.id,
          subscriptionId: m.subscriptionId,
          url: m.subscription.url,
          event: m.event,
          status: m.status,
          attempts: m.attempts,
          lastStatusCode: m.lastStatusCode,
          lastDurationMs: m.lastDurationMs,
          replayOfId: m.replayOfId,
          createdAt: m.createdAt.toISOString(),
        },
        requestBody: request.text ?? '',
        requestBodyTruncated: request.truncated,
        attempts: m.deliveries.map((d) => {
          const body = safeBody(d.responseBody);
          return {
            id: d.id,
            attempt: d.attempt,
            statusCode: d.statusCode,
            success: d.success,
            durationMs: d.durationMs,
            errorMessage: d.errorMessage ? redactWebhookText(d.errorMessage) : null,
            requestHeaders: safeHeaders(d.requestHeaders),
            responseBody: body.text,
            responseTruncated: d.responseTruncated || body.truncated,
            createdAt: d.createdAt.toISOString(),
          };
        }),
      };
    },
  );

  server.post(
    '/webhook-messages/:id/replay',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      preHandler: [server.requirePermission('webhooks:replay'), requireHumanReplay],
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({ requestId: z.string().uuid() }),
        response: { 202: z.object({ outboxId: z.string().uuid(), duplicate: z.boolean() }) },
      },
    },
    async (req, reply) => {
      const m = await prisma.webhookMessage.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId },
        select: { id: true, event: true, payload: true, subscriptionId: true },
      });
      if (!m) throw server.httpErrors.notFound('Message not found');
      const endpoint = await prisma.webhookSubscription.findFirst({
        where: { id: m.subscriptionId, orgId: req.auth.orgId, active: true, deletedAt: null },
        select: { id: true },
      });
      if (!endpoint) throw server.httpErrors.conflict('The endpoint is paused or deleted; resume it before replaying');
      const result = await prisma.$transaction(async (tx) => {
        const outbox = await recordWebhookOutboxEvent(tx, {
          orgId: req.auth.orgId,
          event: m.event,
          payload: (m.payload ?? {}) as Record<string, unknown>,
          idempotencyKey: `replay_${m.id}_${req.body.requestId}`,
          subscriptionId: m.subscriptionId,
          replayOfId: m.id,
        });
        if (!outbox.duplicate) {
          await tx.auditLog.create({
            data: {
              org: { connect: { id: req.auth.orgId } },
              user: { connect: { id: req.auth.userId } },
              action: 'webhook_message.replay',
              targetType: 'WebhookMessage',
              targetId: m.id,
              diff: { outboxId: outbox.id, subscriptionId: m.subscriptionId, event: m.event },
            },
          });
        }
        return outbox;
      });
      return reply.code(202).send({ outboxId: result.id, duplicate: result.duplicate });
    },
  );

  server.get(
    '/webhook-deliveries/stats',
    {
      preHandler: server.requirePermission('webhooks:read'),
      schema: {
        querystring: z.object({
          subscriptionId: z.string().uuid().optional(),
          event: z.string().max(100).optional(),
          status: z.enum(WEBHOOK_MESSAGE_STATUSES).optional(),
          window: z.enum(['24h', '7d', '30d']).default('24h'),
        }),
        response: {
          200: z.object({
            messages: z.object({
              total: z.number().int(),
              succeeded: z.number().int(),
              failed: z.number().int(),
              pending: z.number().int(),
            }),
            successRate: z.number().nullable(),
            heatmap: z.array(
              z.object({
                subscriptionId: z.string().uuid(),
                hour: z.number().int(),
                attempts: z.number().int(),
                failures: z.number().int(),
              }),
            ),
            latencyMs: z.array(z.number().int()),
          }),
        },
      },
    },
    async (req) => {
      const q = req.query;
      const since = new Date(Date.now() - STATS_WINDOWS[q.window] * 3_600_000);
      const messageWhere: Prisma.WebhookMessageWhereInput = {
        orgId: req.auth.orgId,
        createdAt: { gte: since },
        ...(q.subscriptionId ? { subscriptionId: q.subscriptionId } : {}),
        ...(q.event ? { event: q.event } : {}),
        ...(q.status ? { status: q.status } : {}),
      };
      const grouped = await prisma.webhookMessage.groupBy({
        by: ['status'],
        where: messageWhere,
        _count: { _all: true },
      });
      const count = (s: string) => grouped.find((g) => g.status === s)?._count._all ?? 0;
      const succeeded = count('succeeded');
      const failed = count('failed');
      const pending = count('pending');
      const total = succeeded + failed + pending;
      const settled = succeeded + failed;

      const subFilter = q.subscriptionId ? Prisma.sql`AND d.subscription_id = ${q.subscriptionId}::uuid` : Prisma.empty;
      const eventFilter = q.event ? Prisma.sql`AND m.event = ${q.event}` : Prisma.empty;
      const statusFilter = q.status
        ? Prisma.sql`AND m.status = ${q.status}::webhook_message_status`
        : Prisma.empty;
      const heatmap = await prisma.$queryRaw<
        Array<{ subscription_id: string; hour: number; attempts: number; failures: number }>
      >`
        SELECT d.subscription_id::text AS subscription_id,
               extract(hour FROM d.created_at AT TIME ZONE 'UTC')::int AS hour,
               count(*)::int AS attempts,
               count(*) FILTER (WHERE NOT d.success)::int AS failures
          FROM webhook_deliveries d
          JOIN webhook_messages m ON m.id = d.message_id
         WHERE d.org_id = ${req.auth.orgId}::uuid
           AND d.created_at >= ${since}
           ${subFilter} ${eventFilter} ${statusFilter}
         GROUP BY 1, 2
         ORDER BY 1, 2`;
      const latency = await prisma.$queryRaw<Array<{ duration_ms: number }>>`
        SELECT d.duration_ms
          FROM webhook_deliveries d
          JOIN webhook_messages m ON m.id = d.message_id
         WHERE d.org_id = ${req.auth.orgId}::uuid
           AND d.created_at >= ${since}
           AND d.duration_ms IS NOT NULL
           ${subFilter} ${eventFilter} ${statusFilter}
         ORDER BY d.created_at DESC
         LIMIT ${LATENCY_SAMPLE_CAP}`;
      return {
        messages: { total, succeeded, failed, pending },
        successRate: settled > 0 ? succeeded / settled : null,
        heatmap: heatmap.map((c) => ({
          subscriptionId: c.subscription_id,
          hour: c.hour,
          attempts: c.attempts,
          failures: c.failures,
        })),
        latencyMs: latency.map((l) => l.duration_ms),
      };
    },
  );
};

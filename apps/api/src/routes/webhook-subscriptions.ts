import { createHmac, randomUUID } from 'node:crypto';

import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '@bidstack/db';
import type { Prisma } from '@bidstack/db';
import {
  DEFAULT_WEBHOOK_RETRY_POLICY,
  WEBHOOK_RETRY_LIMITS,
  WebhookEventKeySchema,
  WebhookRetryPolicySchema,
  assertSafeWebhookUrl,
  type WebhookRetryPolicy,
} from '@bidstack/shared';
import {
  decryptWebhookSigningSecret,
  encryptSecret,
  hashWebhookSigningSecret,
} from '@bidstack/shared/server-crypto';
import { assertUrlResolvesPublic } from '@bidstack/shared/server';
import {
  assertSerumConnectorAllowed,
  recordSerumConnectorTestSuccess,
} from '../lib/serum-connector-policy.js';

const WebhookSub = z.object({
  id: z.string().uuid(),
  url: z.string(),
  events: z.array(z.string()),
  active: z.boolean(),
  failureCount: z.number().int(),
  lastDeliveryAt: z.string().datetime().nullable(),
  lastFailureAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  timeoutMs: z.number().int(),
});

const WebhookSubCreated = WebhookSub.extend({
  signingSecret: z.string(),
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
  events: z.array(WebhookEventKeySchema).max(50).min(1),
  active: z.boolean().default(true),
  timeoutMs: z
    .number()
    .int()
    .min(WEBHOOK_RETRY_LIMITS.timeoutMs.min)
    .max(WEBHOOK_RETRY_LIMITS.timeoutMs.max)
    .default(DEFAULT_WEBHOOK_RETRY_POLICY.timeoutMs),
});

const WebhookSubUpdate = z.object({
  url: z.string().url().max(500).optional(),
  events: z.array(WebhookEventKeySchema).max(50).min(1).optional(),
  active: z.boolean().optional(),
  timeoutMs: z.number().int().min(WEBHOOK_RETRY_LIMITS.timeoutMs.min).max(WEBHOOK_RETRY_LIMITS.timeoutMs.max).optional(),
});

const RotateSecretBody = z.object({
  overlapHours: z.number().int().min(0).max(72).default(24),
});

function newSigningSecret(): string {
  return `whsec_${Buffer.from(randomUUID()).toString('base64url')}`;
}

function retryPolicyOf(sub: {
  maxAttempts: number;
  backoffStrategy: WebhookRetryPolicy['backoffStrategy'];
  backoffBaseSeconds: number;
  timeoutMs: number;
}): WebhookRetryPolicy {
  return {
    maxAttempts: sub.maxAttempts,
    backoffStrategy: sub.backoffStrategy,
    backoffBaseSeconds: sub.backoffBaseSeconds,
    timeoutMs: sub.timeoutMs,
  };
}

async function requireHumanWebhookWrite(req: FastifyRequest): Promise<void> {
  if (req.auth.role === 'api' || req.auth.userId.startsWith('apikey:')) {
    throw req.server.httpErrors.forbidden('Webhook subscription writes require a user session');
  }
}

function webhookSubscriptionAuditData(args: {
  orgId: string;
  userId: string;
  action:
    | 'webhook_subscription.create'
    | 'webhook_subscription.update'
    | 'webhook_subscription.delete'
    | 'webhook_subscription.retry_policy'
    | 'webhook_subscription.rotate_secret';
  subscriptionId: string;
  diff?: Prisma.InputJsonValue;
}): Prisma.AuditLogCreateInput {
  return {
    org: { connect: { id: args.orgId } },
    user: { connect: { id: args.userId } },
    action: args.action,
    targetType: 'WebhookSubscription',
    targetId: args.subscriptionId,
    diff: args.diff ?? {},
  };
}

export const webhookSubscriptionsRoutes: FastifyPluginAsyncZod = async (server) => {
  server.get(
    '/webhook-subscriptions',
    {
      preHandler: server.requirePermission('webhooks:read'),
      schema: {
        response: {
          200: z.object({
            items: z.array(WebhookSub),
            pageContinues: z.boolean(),
          }),
        },
      },
    },
    async (req) => {
      // One row past the page is the probe. It is dropped and is not a webhook total.
      const WEBHOOK_LIST_PAGE = 500;
      const loaded = await prisma.webhookSubscription.findMany({
        where: { orgId: req.auth.orgId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: WEBHOOK_LIST_PAGE + 1,
        select: {
          id: true,
          url: true,
          events: true,
          active: true,
          failureCount: true,
          lastDeliveryAt: true,
          lastFailureAt: true,
          createdAt: true,
          timeoutMs: true,
        },
      });
      const pageContinues = loaded.length > WEBHOOK_LIST_PAGE;
      const rows = pageContinues ? loaded.slice(0, WEBHOOK_LIST_PAGE) : loaded;
      return {
        pageContinues,
        items: rows.map((s) => ({
          id: s.id,
          url: s.url,
          events: s.events,
          active: s.active,
          failureCount: s.failureCount,
          lastDeliveryAt: s.lastDeliveryAt?.toISOString() ?? null,
          lastFailureAt: s.lastFailureAt?.toISOString() ?? null,
          createdAt: s.createdAt.toISOString(),
          timeoutMs: s.timeoutMs,
        })),
      };
    },
  );

  server.post(
    '/webhook-subscriptions',
    {
      config: { rateLimit: { max: 15, timeWindow: '1 minute' } },
      preHandler: [server.requirePermission('webhooks:write'), requireHumanWebhookWrite],
      schema: {
        body: WebhookSubCreate,
        response: { 201: WebhookSubCreated },
      },
    },
    async (req, reply) => {
      // SSRF defense: reject private/internal URLs.
      try {
        assertSafeWebhookUrl(req.body.url);
      } catch (err) {
        throw server.httpErrors.badRequest(err instanceof Error ? err.message : 'Invalid URL');
      }
      const secret = newSigningSecret();
      const subscriptionId = randomUUID();
      const [created] = await prisma.$transaction([
        prisma.webhookSubscription.create({
          data: {
            id: subscriptionId,
            orgId: req.auth.orgId,
            url: req.body.url,
            // Store the HMAC signing secret encrypted at rest; the plaintext is
            // returned to the caller once below (signingSecret) and never again.
            secret: encryptSecret(secret),
            secretHash: hashWebhookSigningSecret(secret),
            events: req.body.events,
            active: req.body.active,
            timeoutMs: req.body.timeoutMs,
          },
        }),
        prisma.auditLog.create({
          data: webhookSubscriptionAuditData({
            orgId: req.auth.orgId,
            userId: req.auth.userId,
            action: 'webhook_subscription.create',
            subscriptionId,
            diff: {
              active: req.body.active,
              events: req.body.events,
              timeoutMs: req.body.timeoutMs,
              urlHost: new URL(req.body.url).hostname,
            },
          }),
        }),
      ]);
      return reply.code(201).send({
        id: created.id,
        url: created.url,
        events: created.events,
        active: created.active,
        failureCount: created.failureCount,
        lastDeliveryAt: null,
        lastFailureAt: null,
        createdAt: created.createdAt.toISOString(),
        timeoutMs: created.timeoutMs,
        signingSecret: secret,
      });
    },
  );

  server.patch(
    '/webhook-subscriptions/:id',
    {
      preHandler: [server.requirePermission('webhooks:write'), requireHumanWebhookWrite],
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

      const [updated] = await prisma.$transaction([
        prisma.webhookSubscription.update({
          where: { id: existing.id },
          data: {
            ...(req.body.url !== undefined ? { url: req.body.url } : {}),
            ...(req.body.events !== undefined ? { events: req.body.events } : {}),
            ...(req.body.active !== undefined ? { active: req.body.active } : {}),
            ...(req.body.timeoutMs !== undefined ? { timeoutMs: req.body.timeoutMs } : {}),
          },
        }),
        prisma.auditLog.create({
          data: webhookSubscriptionAuditData({
            orgId: req.auth.orgId,
            userId: req.auth.userId,
            action: 'webhook_subscription.update',
            subscriptionId: existing.id,
            diff: {
              changedFields: Object.keys(req.body),
              ...(req.body.url !== undefined ? { urlHost: new URL(req.body.url).hostname } : {}),
              ...(req.body.events !== undefined ? { events: req.body.events } : {}),
              ...(req.body.active !== undefined ? { active: req.body.active } : {}),
              ...(req.body.timeoutMs !== undefined ? { timeoutMs: req.body.timeoutMs } : {}),
            },
          }),
        }),
      ]);
      return {
        id: updated.id,
        url: updated.url,
        events: updated.events,
        active: updated.active,
        failureCount: updated.failureCount,
        lastDeliveryAt: updated.lastDeliveryAt?.toISOString() ?? null,
        lastFailureAt: updated.lastFailureAt?.toISOString() ?? null,
        createdAt: updated.createdAt.toISOString(),
        timeoutMs: updated.timeoutMs,
      };
    },
  );

  server.delete(
    '/webhook-subscriptions/:id',
    {
      preHandler: [server.requirePermission('webhooks:write'), requireHumanWebhookWrite],
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
      await prisma.$transaction([
        prisma.webhookSubscription.update({
          where: { id: existing.id },
          data: { deletedAt: new Date() },
        }),
        prisma.auditLog.create({
          data: webhookSubscriptionAuditData({
            orgId: req.auth.orgId,
            userId: req.auth.userId,
            action: 'webhook_subscription.delete',
            subscriptionId: existing.id,
          }),
        }),
      ]);
      return reply.code(204).send();
    },
  );

  // ── Retry policy ──────────────────────────────────────────────────────────

  async function findOwnedSubscription(req: FastifyRequest, id: string) {
    const sub = await prisma.webhookSubscription.findFirst({
      where: { id, orgId: req.auth.orgId, deletedAt: null },
    });
    if (!sub) throw server.httpErrors.notFound('Subscription not found');
    return sub;
  }

  async function saveRetryPolicy(req: FastifyRequest, id: string, policy: WebhookRetryPolicy) {
    const existing = await findOwnedSubscription(req, id);
    const [updated] = await prisma.$transaction([
      prisma.webhookSubscription.update({ where: { id: existing.id }, data: policy }),
      prisma.auditLog.create({
        data: webhookSubscriptionAuditData({
          orgId: req.auth.orgId,
          userId: req.auth.userId,
          action: 'webhook_subscription.retry_policy',
          subscriptionId: existing.id,
          diff: { ...policy, previous: retryPolicyOf(existing) },
        }),
      }),
    ]);
    return retryPolicyOf(updated);
  }

  server.get(
    '/webhook-subscriptions/:id/retry-policy',
    {
      preHandler: server.requirePermission('webhooks:read'),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: WebhookRetryPolicySchema },
      },
    },
    async (req) => retryPolicyOf(await findOwnedSubscription(req, req.params.id)),
  );

  server.put(
    '/webhook-subscriptions/:id/retry-policy',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      preHandler: [server.requirePermission('webhooks:write'), requireHumanWebhookWrite],
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: WebhookRetryPolicySchema,
        response: { 200: WebhookRetryPolicySchema },
      },
    },
    async (req) => saveRetryPolicy(req, req.params.id, req.body),
  );

  server.delete(
    '/webhook-subscriptions/:id/retry-policy',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      preHandler: [server.requirePermission('webhooks:write'), requireHumanWebhookWrite],
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: WebhookRetryPolicySchema },
      },
    },
    async (req) => saveRetryPolicy(req, req.params.id, { ...DEFAULT_WEBHOOK_RETRY_POLICY }),
  );

  // ── Secret rotation ───────────────────────────────────────────────────────

  server.post(
    '/webhook-subscriptions/:id/rotate-secret',
    {
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
      preHandler: [server.requirePermission('webhooks:write'), requireHumanWebhookWrite],
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: RotateSecretBody,
        response: {
          200: z.object({
            signingSecret: z.string(),
            previousSecretExpiresAt: z.string().datetime().nullable(),
          }),
        },
      },
    },
    async (req) => {
      const existing = await findOwnedSubscription(req, req.params.id);
      // A second rotation inside the overlap window would drop the secret
      // receivers were promised for the whole window.
      if (existing.previousSecretExpiresAt && existing.previousSecretExpiresAt.getTime() > Date.now()) {
        throw server.httpErrors.conflict(
          `A rotation is already in progress until ${existing.previousSecretExpiresAt.toISOString()}`,
        );
      }
      const secret = newSigningSecret();
      const overlapHours = req.body.overlapHours;
      const previousSecretExpiresAt =
        overlapHours > 0 ? new Date(Date.now() + overlapHours * 3_600_000) : null;
      const [rotated] = await prisma.$transaction([
        // Conditional on the secret we read, so two concurrent rotations
        // cannot both copy it into previousSecret.
        prisma.webhookSubscription.updateMany({
          where: { id: existing.id, orgId: req.auth.orgId, secret: existing.secret },
          data: {
            // Encrypted at rest like on create; the plaintext is returned once.
            secret: encryptSecret(secret),
            secretHash: hashWebhookSigningSecret(secret),
            previousSecret: previousSecretExpiresAt ? existing.secret : null,
            previousSecretExpiresAt,
          },
        }),
        prisma.auditLog.create({
          data: webhookSubscriptionAuditData({
            orgId: req.auth.orgId,
            userId: req.auth.userId,
            action: 'webhook_subscription.rotate_secret',
            subscriptionId: existing.id,
            diff: { overlapHours, previousSecretExpiresAt: previousSecretExpiresAt?.toISOString() ?? null },
          }),
        }),
      ]);
      if (rotated.count === 0) throw server.httpErrors.conflict('The secret changed during rotation; try again');
      return {
        signingSecret: secret,
        previousSecretExpiresAt: previousSecretExpiresAt?.toISOString() ?? null,
      };
    },
  );

  // ── Delivery history ──────────────────────────────────────────────────────

  server.get(
    '/webhook-subscriptions/:id/deliveries',
    {
      preHandler: server.requirePermission('webhooks:read'),
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
      preHandler: [server.requirePermission('webhooks:write'), requireHumanWebhookWrite],
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
        select: { id: true, orgId: true, url: true, secret: true },
      });
      if (!sub) throw server.httpErrors.notFound('Subscription not found');

      try {
        assertSafeWebhookUrl(sub.url);
      } catch (err) {
        throw server.httpErrors.badRequest(
          err instanceof Error
            ? `Stored webhook URL is unsafe: ${err.message}`
            : 'Stored webhook URL is unsafe',
        );
      }

      const pingBody = JSON.stringify({
        id: randomUUID(),
        event: 'ping',
        orgId: req.auth.orgId,
        timestamp: new Date().toISOString(),
        data: { message: 'This is a test ping from Polo PreSales webhooks.' },
      });

      await assertSerumConnectorAllowed({
        orgId: sub.orgId,
        connectorId: 'webhook_delivery',
        operation: 'webhook.testPing',
        writeRequested: true,
        connectionTestProbe: true,
      });

      const start = Date.now();

      let result: {
        success: boolean;
        statusCode: number | null;
        durationMs: number;
        error?: string;
      };
      let signature: string | null = null;
      try {
        const t = Math.floor(Date.now() / 1000);
        const signingSecret = decryptWebhookSigningSecret(sub.secret);
        const sig = createHmac('sha256', signingSecret).update(`${t}.${pingBody}`).digest('hex');
        signature = `t=${t},v1=${sig}`;
      } catch {
        result = {
          success: false,
          statusCode: null,
          durationMs: Date.now() - start,
          error:
            'Stored webhook signing secret is unreadable; run webhook secret encryption backfill.',
        };
      }

      try {
        if (!signature) {
          throw new Error(result!.error);
        }
        // Close the DNS-rebind gap the comment below names: resolve sub.url and
        // reject if it points at an internal/metadata address before connecting.
        // The static assertSafeWebhookUrl (string) check ran at registration.
        await assertUrlResolvesPublic(sub.url);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), TEST_PING_TIMEOUT_MS);
        let res: Response;
        try {
          res = await fetch(sub.url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Polo-Signature': signature,
              // Legacy header kept during the rebrand deprecation window.
              'X-BidStack-Signature': signature,
              'User-Agent': 'PoloPreSales-Webhooks/1.0',
            },
            body: pingBody,
            signal: controller.signal,
            // SSRF: refuse to follow redirects — a 30x to an internal host would
            // bypass the static assertSafeWebhookUrl check on the original URL.
            // (Full DNS-rebind parity with the worker's safe-research-fetch is
            // follow-up once that helper moves to a shared package.)
            redirect: 'error',
          });
        } finally {
          clearTimeout(timeoutId);
        }
        result = {
          success: res.status >= 200 && res.status < 300,
          statusCode: res.status,
          durationMs: Date.now() - start,
        };
      } catch (err) {
        result = {
          success: false,
          statusCode: null,
          durationMs: Date.now() - start,
          error: err instanceof Error ? err.message : String(err),
        };
      }

      await prisma.webhookDelivery.create({
        data: {
          orgId: sub.orgId,
          subscriptionId: sub.id,
          event: 'ping',
          statusCode: result.statusCode,
          success: result.success,
          durationMs: result.durationMs,
          attempt: 1,
          errorMessage: result.error ?? null,
        },
      });

      await prisma.webhookSubscription.update({
        where: { id: sub.id },
        data: result.success ? { lastDeliveryAt: new Date() } : { lastFailureAt: new Date() },
      });

      if (result.success) {
        await recordSerumConnectorTestSuccess({
          orgId: sub.orgId,
          connectorId: 'webhook_delivery',
          operation: 'webhook.testPing',
          testedByUserId: req.auth.userId,
          evidence: { subscriptionId: sub.id, statusCode: result.statusCode },
        });
      }

      return result;
    },
  );
};

/**
 * Twilio SMS routes.
 *
 * Public webhook routes (no auth):
 *  POST /integrations/twilio/webhook/status  — Twilio delivery status callbacks
 *  POST /integrations/twilio/webhook/inbound — Twilio inbound SMS
 *
 * Authenticated routes:
 *  POST /sms/send               — send an SMS to a contact/lead
 *  GET  /sms/messages           — list SMS history for an entity
 *  GET  /sms/consent/:phone     — check opt-out status for a phone number
 *
 * WHY separate prefix for webhooks: Twilio calls these unauthenticated; they
 * are validated via X-Twilio-Signature instead. Keeping them under
 * /integrations/twilio/ groups them logically with the integration family.
 *
 * WHY we do NOT use the /api/v1 rate-limit bucket for webhook routes: Twilio
 * can burst many status callbacks in quick succession; rate-limiting them
 * would cause 429 responses and force Twilio to retry, causing delays.
 */

import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma } from '@bidstack/db';
import {
  sendSms,
  testTwilioConnection,
  handleStatusCallback,
  handleInboundSms,
  validateTwilioSignature,
} from '../../services/twilio-sms.service.js';

// ─── Webhook routes (no auth) ──────────────────────────────────────────────

export const twilioWebhookRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /**
   * Twilio status callback — called for every state transition on a message.
   * Validates X-Twilio-Signature before processing.
   */
  app.post(
    '/twilio/webhook/status',
    {
      // Twilio sends no Clerk JWT — the route self-protects via
      // X-Twilio-Signature validation below (same pattern as /webhooks/dust).
      config: { public: true },
      schema: {
        description: 'Twilio delivery status webhook',
        tags: ['twilio'],
        body: z.object({
          MessageSid: z.string(),
          MessageStatus: z.string(),
          To: z.string().optional(),
          From: z.string().optional(),
          ErrorCode: z.string().optional(),
          Price: z.string().optional(),
          NumSegments: z.string().optional(),
        }),
        response: {
          200: z.object({ ok: z.boolean() }),
          403: z.object({ ok: z.boolean() }),
          404: z.object({ ok: z.boolean() }),
        },
      },
    },
    async (req, reply) => {
      const signature = req.headers['x-twilio-signature'] as string | undefined;

      if (!signature) {
        return reply.code(403).send({ ok: false } as never);
      }

      const twilioNumber = req.body.From ?? req.body.To ?? '';
      // Look up org by matching the Twilio sender number to an integration token.
      const token = await prisma.integrationToken.findFirst({
        where: {
          provider: 'twilio',
          status: 'active',
          externalAccountId: twilioNumber,
        },
        select: { orgId: true },
      });

      if (!token) {
        // Fallback: try to find by twilioSid in existing message
        const msg = await prisma.smsMessage.findFirst({
          where: { twilioSid: req.body.MessageSid },
          select: { orgId: true, fromNumber: true },
        });
        if (!msg) return reply.code(404).send({ ok: false } as never);

        const valid = await validateTwilioSignature(
          msg.orgId,
          signature,
          `${process.env.PUBLIC_API_URL ?? ''}/api/v1/integrations/twilio/webhook/status`,
          req.body as Record<string, string>,
          msg.fromNumber,
        );
        if (!valid) return reply.code(403).send({ ok: false } as never);

        await handleStatusCallback(req.body, req.log);
        return reply.send({ ok: true });
      }

      const valid = await validateTwilioSignature(
        token.orgId,
        signature,
        `${process.env.PUBLIC_API_URL ?? ''}/api/v1/integrations/twilio/webhook/status`,
        req.body as Record<string, string>,
        twilioNumber,
      );

      if (!valid) {
        return reply.code(403).send({ ok: false } as never);
      }

      await handleStatusCallback(req.body, req.log);
      return reply.send({ ok: true });
    },
  );

  /**
   * Twilio inbound SMS — handles STOP keywords (opt-out) and inbound messages.
   */
  app.post(
    '/twilio/webhook/inbound',
    {
      // Public for the same reason as /twilio/webhook/status above.
      config: { public: true },
      schema: {
        description: 'Twilio inbound SMS webhook',
        tags: ['twilio'],
        body: z.object({
          MessageSid: z.string(),
          From: z.string(),
          To: z.string(),
          Body: z.string(),
          NumSegments: z.string().optional(),
        }),
        response: {
          200: z.object({ ok: z.boolean() }),
          403: z.object({ ok: z.boolean() }),
          404: z.object({ ok: z.boolean() }),
        },
      },
    },
    async (req, reply) => {
      const signature = req.headers['x-twilio-signature'] as string | undefined;
      if (!signature) return reply.code(403).send({ ok: false } as never);

      // Match org by To number
      const token = await prisma.integrationToken.findFirst({
        where: { provider: 'twilio', status: 'active', externalAccountId: req.body.To },
        select: { orgId: true },
      });

      if (!token) return reply.code(404).send({ ok: false } as never);

      const valid = await validateTwilioSignature(
        token.orgId,
        signature,
        `${process.env.PUBLIC_API_URL ?? ''}/api/v1/integrations/twilio/webhook/inbound`,
        req.body as Record<string, string>,
        req.body.To,
      );

      if (!valid) return reply.code(403).send({ ok: false } as never);

      await handleInboundSms(token.orgId, req.body, req.log);
      return reply.send({ ok: true });
    },
  );
};

// ─── Authenticated SMS routes ──────────────────────────────────────────────

export const smsRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.post(
    '/integrations/twilio/test',
    {
      // WHY integrations:read: returns the connected account SID suffix + from
      // number (integration config) — gate it so non-integration roles can't
      // enumerate the org's Twilio configuration.
      preHandler: fastify.requirePermission('integrations:read'),
      schema: {
        description: 'Test the active Twilio connection without sending an SMS',
        tags: ['sms'],
        response: {
          200: z.object({
            ok: z.literal(true),
            accountSidSuffix: z.string(),
            fromNumber: z.string(),
          }),
        },
      },
    },
    async (req, reply) => {
      const auth = (req as unknown as { auth: { orgId: string; userId: string } }).auth;
      const result = await testTwilioConnection(auth.orgId, auth.userId, req.log);
      return reply.send(result);
    },
  );

  /**
   * Send an SMS to a contact or lead.
   * The authenticated user's orgId is taken from req.auth.
   */
  app.post(
    '/sms/send',
    {
      // WHY integrations:write: sending SMS incurs real cost + carries abuse and
      // impersonation risk — must be gated to write principals, not any
      // authenticated user or a read-scoped API key.
      preHandler: fastify.requirePermission('integrations:write'),
      schema: {
        description: 'Send an SMS message via Twilio',
        tags: ['sms'],
        body: z.object({
          toNumber: z.string().regex(/^\+[1-9]\d{1,14}$/, 'Must be E.164 format (+1234567890)'),
          body: z.string().min(1).max(1600),
          entityType: z.enum(['CONTACT', 'LEAD']).optional(),
          entityId: z.string().uuid().optional(),
        }),
        response: {
          200: z.object({ messageId: z.string().uuid() }),
          403: z.object({ error: z.string() }),
        },
      },
    },
    async (req, reply) => {
      // WHY cast: auth is populated by authPlugin; type narrowing here avoids
      // adding a dependency on the internal auth types in a route file.
      const auth = (req as unknown as { auth: { orgId: string; userId: string } }).auth;

      const result = await sendSms(
        {
          orgId: auth.orgId,
          userId: auth.userId,
          toNumber: req.body.toNumber,
          body: req.body.body,
          entityType: req.body.entityType,
          entityId: req.body.entityId,
        },
        req.log,
      );

      return reply.send(result);
    },
  );

  /**
   * List SMS messages for a CRM entity (contact or lead).
   */
  app.get(
    '/sms/messages',
    {
      schema: {
        description: 'List SMS messages for a CRM entity',
        tags: ['sms'],
        querystring: z.object({
          entityType: z.enum(['CONTACT', 'LEAD']).optional(),
          entityId: z.string().uuid().optional(),
          limit: z.coerce.number().int().min(1).max(100).default(50),
          cursor: z.string().uuid().optional(),
        }),
        response: {
          200: z.object({
            messages: z.array(
              z.object({
                id: z.string().uuid(),
                fromNumber: z.string(),
                toNumber: z.string(),
                body: z.string(),
                status: z.string(),
                twilioSid: z.string().nullable(),
                segments: z.number(),
                sentAt: z.string().nullable(),
                deliveredAt: z.string().nullable(),
                createdAt: z.string(),
              }),
            ),
            nextCursor: z.string().uuid().nullable(),
          }),
        },
      },
    },
    async (req, reply) => {
      const auth = (req as unknown as { auth: { orgId: string } }).auth;
      const { entityType, entityId, limit, cursor } = req.query;

      const messages = await prisma.smsMessage.findMany({
        where: {
          orgId: auth.orgId,
          ...(entityType ? { entityType } : {}),
          ...(entityId ? { entityId } : {}),
          ...(cursor ? { id: { lt: cursor } } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: limit + 1,
        select: {
          id: true,
          fromNumber: true,
          toNumber: true,
          body: true,
          status: true,
          twilioSid: true,
          segments: true,
          sentAt: true,
          deliveredAt: true,
          createdAt: true,
        },
      });

      const hasMore = messages.length > limit;
      const page = hasMore ? messages.slice(0, limit) : messages;
      const nextCursor = hasMore ? (page[page.length - 1]?.id ?? null) : null;

      return reply.send({
        messages: page.map((m) => ({
          ...m,
          sentAt: m.sentAt?.toISOString() ?? null,
          deliveredAt: m.deliveredAt?.toISOString() ?? null,
          createdAt: m.createdAt.toISOString(),
        })),
        nextCursor,
      });
    },
  );

  /**
   * Check opt-out consent status for a phone number.
   */
  app.get(
    '/sms/consent/:phoneNumber',
    {
      schema: {
        description: 'Check TCPA opt-out status for a phone number',
        tags: ['sms'],
        params: z.object({ phoneNumber: z.string() }),
        response: {
          200: z.object({
            phoneNumber: z.string(),
            optedOut: z.boolean(),
            optedOutAt: z.string().nullable(),
            source: z.string().nullable(),
          }),
        },
      },
    },
    async (req, reply) => {
      const auth = (req as unknown as { auth: { orgId: string } }).auth;
      const { phoneNumber } = req.params;

      const consent = await prisma.smsConsent.findUnique({
        where: { orgId_phoneNumber: { orgId: auth.orgId, phoneNumber } },
        select: { optedOut: true, optedOutAt: true, source: true },
      });

      return reply.send({
        phoneNumber,
        optedOut: consent?.optedOut ?? false,
        optedOutAt: consent?.optedOutAt?.toISOString() ?? null,
        source: consent?.source ?? null,
      });
    },
  );
};

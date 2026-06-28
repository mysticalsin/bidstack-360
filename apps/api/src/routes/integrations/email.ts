/**
 * Email API routes — send + list messages for Gmail/Outlook integrations.
 *
 * All routes are multi-tenant scoped via req.auth.orgId.
 */

import type { FastifyPluginAsync } from 'fastify';
import { type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma } from '@bidstack/db';
import { SendEmailRequest, type EmailMessageDto, EmailListResponse } from '@bidstack/shared';
import { sendEmail } from '../../services/email-integration.service.js';

export const emailRoutes: FastifyPluginAsync = async (server) => {
  const app = server.withTypeProvider<ZodTypeProvider>();

  // POST /email/send
  // WHY integrations:write: sending mail from the org's connected mailbox is a
  // privileged outbound action — a read-only role or a read-scoped API key must
  // not be able to send (impersonation/abuse). Mirrors the SMS send gate.
  app.post('/email/send', {
    preHandler: server.requirePermission('integrations:write'),
    schema: {
      body: SendEmailRequest,
      response: {
        200: z.object({ messageId: z.string().uuid() }),
      },
    },
    handler: async (req, reply) => {
      const { orgId, userId } = req.auth;
      const { messageId } = await sendEmail(
        {
          orgId,
          userId,
          to: req.body.to,
          cc: req.body.cc,
          bcc: req.body.bcc,
          subject: req.body.subject,
          html: req.body.html,
          text: req.body.text,
          entityType: req.body.entityType,
          entityId: req.body.entityId,
        },
        server.log,
      );
      return reply.send({ messageId });
    },
  });

  // GET /email/messages?entityType=&entityId=&page=&limit=
  app.get('/email/messages', {
    schema: {
      querystring: z.object({
        entityType: z.string().optional(),
        entityId: z.string().uuid().optional(),
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(25),
      }),
      response: { 200: EmailListResponse },
    },
    handler: async (req, reply) => {
      const { orgId } = req.auth;
      const { entityType, entityId, page, limit } = req.query;

      const where = {
        orgId,
        deletedAt: undefined,
        ...(entityType ? { entityType } : {}),
        ...(entityId ? { entityId } : {}),
      };

      const [messages, total] = await Promise.all([
        prisma.emailMessage.findMany({
          where,
          orderBy: [{ sentAt: 'desc' }, { receivedAt: 'desc' }],
          take: limit,
          skip: (page - 1) * limit,
        }),
        prisma.emailMessage.count({ where }),
      ]);

      return reply.send({
        messages: messages.map((m) => ({
          id: m.id,
          orgId: m.orgId,
          userId: m.userId,
          provider: m.provider,
          externalMessageId: m.externalMessageId,
          threadId: m.threadId,
          fromEmail: m.fromEmail,
          toEmails: m.toEmails as EmailMessageDto['toEmails'],
          ccEmails: m.ccEmails as EmailMessageDto['ccEmails'],
          subject: m.subject,
          bodyText: m.bodyText,
          isOutbound: m.isOutbound,
          sentAt: m.sentAt?.toISOString() ?? null,
          receivedAt: m.receivedAt?.toISOString() ?? null,
          openedAt: m.openedAt?.toISOString() ?? null,
          clickedAt: m.clickedAt?.toISOString() ?? null,
          entityType: m.entityType,
          entityId: m.entityId,
          createdAt: m.createdAt.toISOString(),
        })),
        total,
        hasMore: total > page * limit,
      });
    },
  });

  // GET /integrations/status — list all integration statuses for the current user
  app.get('/integrations/status', {
    schema: {
      response: {
        200: z.object({
          integrations: z.array(
            z.object({
              provider: z.string(),
              status: z.enum(['CONNECTED', 'DISCONNECTED', 'ERROR']),
              connectedEmail: z.string().nullable(),
              lastSyncedAt: z.string().nullable(),
              errorMessage: z.string().nullable(),
              scopes: z.array(z.string()),
            }),
          ),
        }),
      },
    },
    handler: async (req, reply) => {
      const { orgId, userId } = req.auth;

      const tokens = await prisma.integrationToken.findMany({
        where: { orgId, userId, deletedAt: null },
        // Defense-in-depth: never load the *Encrypted token columns into memory
        // for a status read — select only the non-secret fields the view uses.
        select: {
          provider: true,
          status: true,
          externalAccountEmail: true,
          lastSyncedAt: true,
          errorMessage: true,
          scope: true,
        },
        take: 100,
      });

      const ALL_PROVIDERS = ['gmail', 'microsoft_graph', 'slack'] as const;

      const integrations = ALL_PROVIDERS.map((provider) => {
        const token = tokens.find((t) => t.provider === provider);
        return {
          provider,
          status: (token?.status === 'active'
            ? 'CONNECTED'
            : token?.status === 'error'
              ? 'ERROR'
              : 'DISCONNECTED') as 'CONNECTED' | 'DISCONNECTED' | 'ERROR',
          connectedEmail: token?.externalAccountEmail ?? null,
          lastSyncedAt: token?.lastSyncedAt?.toISOString() ?? null,
          errorMessage: token?.errorMessage ?? null,
          scopes: token?.scope ?? [],
        };
      });

      return reply.send({ integrations });
    },
  });
};

/**
 * Email API routes: captured messages, thread view and Polo-only drafts.
 * Send needs a send grant; connect grants read-only scopes, so it answers 409.
 *
 * All routes are multi-tenant scoped via req.auth.orgId.
 */

import type { FastifyPluginAsync } from 'fastify';
import { type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma } from '@bidstack/db';
import {
  CreateEmailDraftRequest,
  EmailDraftDto,
  EmailDraftListResponse,
  EmailListResponse,
  type EmailMessageDto,
  EmailThreadResponse,
  SendEmailRequest,
} from '@bidstack/shared';
import { sendEmail } from '../../services/email-integration.service.js';

type Recipients = EmailMessageDto['toEmails'];
type EmailMessage = NonNullable<Awaited<ReturnType<typeof prisma.emailMessage.findFirst>>>;
type EmailDraft = NonNullable<Awaited<ReturnType<typeof prisma.emailDraft.findFirst>>>;

function messageTime(m: EmailMessage): number {
  return (m.receivedAt ?? m.sentAt ?? m.createdAt).getTime();
}

function toMessageDto(m: EmailMessage): EmailMessageDto {
  return {
    id: m.id,
    orgId: m.orgId,
    userId: m.userId,
    provider: m.provider,
    externalMessageId: m.externalMessageId,
    threadId: m.threadId,
    fromEmail: m.fromEmail,
    toEmails: m.toEmails as Recipients,
    ccEmails: m.ccEmails as Recipients,
    subject: m.subject,
    bodyText: m.bodyText,
    isOutbound: m.isOutbound,
    sentAt: m.sentAt?.toISOString() ?? null,
    receivedAt: m.receivedAt?.toISOString() ?? null,
    openedAt: m.openedAt?.toISOString() ?? null,
    clickedAt: m.clickedAt?.toISOString() ?? null,
    entityType: m.entityType,
    entityId: m.entityId,
    contactId: m.contactId,
    companyId: m.companyId,
    opportunityId: m.opportunityId,
    createdAt: m.createdAt.toISOString(),
  };
}

function toDraftDto(d: EmailDraft): EmailDraftDto {
  return {
    id: d.id,
    status: 'draft',
    to: d.toEmails as Recipients,
    cc: d.ccEmails as Recipients,
    subject: d.subject,
    text: d.bodyText,
    threadId: d.threadId,
    contactId: d.contactId,
    companyId: d.companyId,
    opportunityId: d.opportunityId,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

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

  // GET /email/messages?entityType=&entityId=&contactId=&companyId=&opportunityId=&page=&limit=
  app.get('/email/messages', {
    config: { permission: 'activities:read' },
    schema: {
      querystring: z.object({
        entityType: z.string().max(32).optional(),
        entityId: z.string().uuid().optional(),
        contactId: z.string().uuid().optional(),
        companyId: z.string().uuid().optional(),
        opportunityId: z.string().uuid().optional(),
        page: z.coerce.number().int().min(1).max(10_000).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(25),
      }),
      response: { 200: EmailListResponse },
    },
    handler: async (req, reply) => {
      const { orgId } = req.auth;
      const { entityType, entityId, contactId, companyId, opportunityId, page, limit } = req.query;

      const where = {
        orgId,
        deletedAt: null,
        ...(entityType ? { entityType } : {}),
        ...(entityId ? { entityId } : {}),
        ...(contactId ? { contactId } : {}),
        ...(companyId ? { companyId } : {}),
        ...(opportunityId ? { opportunityId } : {}),
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

      return reply.send({ messages: messages.map(toMessageDto), total, hasMore: total > page * limit });
    },
  });

  // GET /email/threads/:threadId — oldest first, capped at 200 messages
  app.get('/email/threads/:threadId', {
    config: { permission: 'activities:read' },
    schema: {
      params: z.object({ threadId: z.string().min(1).max(256) }),
      response: { 200: EmailThreadResponse },
    },
    handler: async (req, reply) => {
      const { orgId } = req.auth;
      const messages = await prisma.emailMessage.findMany({
        where: { orgId, threadId: req.params.threadId, deletedAt: null },
        orderBy: [{ receivedAt: 'asc' }, { sentAt: 'asc' }, { createdAt: 'asc' }],
        take: 200,
      });
      if (messages.length === 0) throw server.httpErrors.notFound('Thread not found');
      const sorted = [...messages].sort((x, y) => messageTime(x) - messageTime(y));
      return reply.send({
        threadId: req.params.threadId,
        subject: sorted[0]?.subject ?? '',
        messages: sorted.map((m) => ({ ...toMessageDto(m), bodyHtml: m.bodyHtml })),
      });
    },
  });

  // POST /email/drafts — saved in Polo only, never handed to the provider.
  // clientRequestId makes a retried save return the same draft.
  app.post('/email/drafts', {
    preHandler: server.requirePermission('activities:write'),
    schema: {
      body: CreateEmailDraftRequest,
      response: { 200: EmailDraftDto, 201: EmailDraftDto },
    },
    handler: async (req, reply) => {
      const { orgId, userId } = req.auth;
      const b = req.body;
      const key = { orgId, userId, clientRequestId: b.clientRequestId };
      const existing = await prisma.emailDraft.findFirst({ where: key });
      if (existing) return reply.status(200).send(toDraftDto(existing));
      try {
        const draft = await prisma.emailDraft.create({
          data: {
            ...key,
            toEmails: b.to,
            ccEmails: b.cc ?? [],
            subject: b.subject,
            bodyText: b.text ?? null,
            threadId: b.threadId ?? null,
            contactId: b.contactId ?? null,
            companyId: b.companyId ?? null,
            opportunityId: b.opportunityId ?? null,
          },
        });
        return reply.status(201).send(toDraftDto(draft));
      } catch (err) {
        if ((err as { code?: string }).code !== 'P2002') throw err;
        const raced = await prisma.emailDraft.findFirst({ where: key });
        if (!raced) throw err;
        return reply.status(200).send(toDraftDto(raced));
      }
    },
  });

  // GET /email/drafts?contactId=&companyId=&opportunityId= — the caller's drafts
  app.get('/email/drafts', {
    config: { permission: 'activities:read' },
    schema: {
      querystring: z.object({
        contactId: z.string().uuid().optional(),
        companyId: z.string().uuid().optional(),
        opportunityId: z.string().uuid().optional(),
        limit: z.coerce.number().int().min(1).max(100).default(25),
      }),
      response: { 200: EmailDraftListResponse },
    },
    handler: async (req, reply) => {
      const { orgId, userId } = req.auth;
      const { contactId, companyId, opportunityId, limit } = req.query;
      const drafts = await prisma.emailDraft.findMany({
        where: {
          orgId,
          userId,
          deletedAt: null,
          ...(contactId ? { contactId } : {}),
          ...(companyId ? { companyId } : {}),
          ...(opportunityId ? { opportunityId } : {}),
        },
        orderBy: { updatedAt: 'desc' },
        take: limit,
      });
      return reply.send({ items: drafts.map(toDraftDto) });
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

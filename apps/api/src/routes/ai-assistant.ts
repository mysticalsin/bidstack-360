import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Logger as PinoLogger } from 'pino';
import { z } from 'zod';

import { prisma } from '@bidstack/db';

import {
  analyzeDealSentiment,
  draftEmail,
  enrichContact,
  prepMeeting,
  summarizeAccountIntel,
} from '../services/ai-assistant.service.js';

const EmailDraftBody = z.object({
  contactId: z.string().uuid().optional(),
  dealId: z.string().uuid().optional(),
  tone: z.enum(['formal', 'friendly', 'direct']).default('friendly'),
  intent: z.string().trim().min(1).max(2_000),
});

const DealSentimentBody = z.object({
  dealId: z.string().uuid(),
});

const MeetingPrepBody = z.object({
  calendarEventId: z.string().uuid(),
});

const ContactEnrichBody = z.object({
  contactId: z.string().uuid(),
});

const AccountIntelBody = z.object({
  accountId: z.string().uuid(),
});

const FeedbackBody = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(2_000).optional(),
});

function aiLog(reqLog: unknown): PinoLogger {
  return reqLog as PinoLogger;
}

export const aiAssistantRoutes: FastifyPluginAsyncZod = async (server) => {
  server.post(
    '/ai-assistant/email-draft',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: { body: EmailDraftBody },
    },
    async (req) =>
      draftEmail(
        {
          orgId: req.auth.orgId,
          userId: req.auth.userId,
          ...req.body,
        },
        aiLog(req.log),
      ),
  );

  server.post(
    '/ai-assistant/deal-sentiment',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: { body: DealSentimentBody },
    },
    async (req) =>
      analyzeDealSentiment(
        {
          orgId: req.auth.orgId,
          userId: req.auth.userId,
          dealId: req.body.dealId,
        },
        aiLog(req.log),
      ),
  );

  server.post(
    '/ai-assistant/meeting-prep',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: { body: MeetingPrepBody },
    },
    async (req) =>
      prepMeeting(
        {
          orgId: req.auth.orgId,
          userId: req.auth.userId,
          calendarEventId: req.body.calendarEventId,
        },
        aiLog(req.log),
      ),
  );

  server.post(
    '/ai-assistant/enrich-contact',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: { body: ContactEnrichBody },
    },
    async (req) =>
      enrichContact(
        {
          orgId: req.auth.orgId,
          userId: req.auth.userId,
          contactId: req.body.contactId,
        },
        aiLog(req.log),
      ),
  );

  server.post(
    '/ai-assistant/account-intel',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: { body: AccountIntelBody },
    },
    async (req) =>
      summarizeAccountIntel(
        {
          orgId: req.auth.orgId,
          userId: req.auth.userId,
          accountId: req.body.accountId,
        },
        aiLog(req.log),
      ),
  );

  server.post(
    '/ai-assistant/sessions/:sessionId/feedback',
    {
      schema: {
        params: z.object({ sessionId: z.string().uuid() }),
        body: FeedbackBody,
      },
    },
    async (req) => {
      const session = await prisma.aiAssistantSession.findFirst({
        where: { id: req.params.sessionId, orgId: req.auth.orgId },
        select: { id: true },
      });

      if (!session) {
        throw server.httpErrors.notFound('AI assistant session not found');
      }

      await prisma.aiAssistantFeedback.create({
        data: {
          sessionId: session.id,
          rating: req.body.rating,
          comment: req.body.comment ?? null,
        },
      });

      return { ok: true };
    },
  );
};

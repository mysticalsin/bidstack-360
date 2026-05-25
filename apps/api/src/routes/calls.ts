/**
 * Call management routes — Wave 8 Voice + Video integration.
 *
 * Authenticated routes (require Bearer token + orgId from auth):
 *   POST /calls/quick-start       — create instant meeting, return joinUrl
 *   POST /calls/schedule          — create scheduled meeting + CalendarEvent
 *   GET  /calls                   — list calls for an entity (paginated)
 *   GET  /calls/:id               — full detail with signed recording URL
 *   POST /calls/:id/extract-insights — re-trigger AI analysis
 *
 * WHY separate from webhook routes: authenticated calls are rate-limited and
 * go through authPlugin; webhooks are unauthenticated, validated via provider
 * signatures, and must NOT be rate-limited to the API bucket (providers burst).
 *
 * Multi-tenancy: every query includes orgId from req.auth. No cross-org leaks.
 */

import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';

import { prisma } from '@bidstack/db';
import { createZoomMeeting } from '../services/calls/zoom.service.js';
import { createTeamsMeeting } from '../services/calls/teams.service.js';
import { createGoogleMeetEvent } from '../services/calls/google-meet.service.js';
import { initiateVoiceCall } from '../services/calls/twilio-voice.service.js';
import { getSignedRecordingUrl } from '../services/calls/recording-storage.service.js';
import { Queue } from 'bullmq';
import { CALL_ANALYZE } from '@bidstack/shared';
import { redis } from '../redis.js';

// ─── Shared Zod schemas ───────────────────────────────────────────────────

const EntityTypeEnum = z.enum(['DEAL', 'CONTACT', 'OPPORTUNITY', 'LEAD']);
const ProviderEnum = z.enum(['ZOOM', 'TEAMS', 'GOOGLE_MEET', 'TWILIO_VOICE']);

const CallSessionSchema = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  userId: z.string().uuid(),
  entityType: z.string(),
  entityId: z.string().uuid(),
  provider: z.string(),
  externalMeetingId: z.string().nullable(),
  joinUrl: z.string().nullable(),
  scheduledAt: z.string().nullable(),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  durationSec: z.number().nullable(),
  participantEmails: z.unknown().nullable(),
  recordingUrl: z.string().nullable(),
  summary: z.string().nullable(),
  actionItems: z.unknown().nullable(),
  sentimentScore: z.number().nullable(),
  talkRatio: z.unknown().nullable(),
  status: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// ─── Auth helper ──────────────────────────────────────────────────────────

function getAuth(req: unknown): { orgId: string; userId: string } {
  // WHY cast: authPlugin populates req.auth; narrowing avoids circular dep on auth types.
  return (req as { auth: { orgId: string; userId: string } }).auth;
}

// ─── Route plugin ─────────────────────────────────────────────────────────

export const callsRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /**
   * POST /calls/quick-start
   * Creates an instant meeting for the given entity and provider.
   * Returns joinUrl immediately for the rep to share.
   */
  app.post(
    '/calls/quick-start',
    {
      schema: {
        description: 'Start an instant video/voice call for a CRM entity',
        tags: ['calls'],
        body: z.object({
          entityType: EntityTypeEnum,
          entityId: z.string().uuid(),
          provider: ProviderEnum,
          /** Optional topic/subject override. Defaults to entity name. */
          topic: z.string().max(200).optional(),
          /** For TWILIO_VOICE: E.164 number to dial. Required for that provider. */
          toPhoneNumber: z.string().optional(),
        }),
        response: {
          200: z.object({
            callSessionId: z.string().uuid(),
            joinUrl: z.string().url().nullable(),
            hostJoinUrl: z.string().url().nullable(),
            provider: ProviderEnum,
          }),
          400: z.object({ error: z.string() }),
          503: z.object({ error: z.string() }),
        },
      },
    },
    async (req, reply) => {
      const auth = getAuth(req);
      const { entityType, entityId, provider, topic, toPhoneNumber } = req.body;

      const title = topic ?? `${entityType} call`;

      let joinUrl: string | null = null;
      let hostJoinUrl: string | null = null;
      let externalMeetingId: string | null = null;

      try {
        if (provider === 'ZOOM') {
          const meeting = await createZoomMeeting({ topic: title });
          joinUrl = meeting.join_url;
          hostJoinUrl = meeting.start_url;
          externalMeetingId = String(meeting.id);
        } else if (provider === 'TEAMS') {
          const meeting = await createTeamsMeeting({
            orgId: auth.orgId,
            userId: auth.userId,
            subject: title,
          });
          joinUrl = meeting.joinWebUrl;
          externalMeetingId = meeting.id;
        } else if (provider === 'GOOGLE_MEET') {
          const event = await createGoogleMeetEvent({
            orgId: auth.orgId,
            userId: auth.userId,
            title,
          });
          joinUrl = event.hangoutLink;
          externalMeetingId = event.id;
        } else if (provider === 'TWILIO_VOICE') {
          if (!toPhoneNumber) {
            return reply.code(400).send({ error: 'toPhoneNumber is required for TWILIO_VOICE' });
          }
          const publicApiUrl = process.env.PUBLIC_API_URL ?? '';
          const sessionId = randomUUID();
          const call = await initiateVoiceCall({
            toNumber: toPhoneNumber,
            twimlUrl: `${publicApiUrl}/api/v1/integrations/twilio-voice/twiml/${sessionId}`,
            statusCallbackUrl: `${publicApiUrl}/api/v1/integrations/twilio-voice/webhook`,
            recordingStatusCallbackUrl: `${publicApiUrl}/api/v1/integrations/twilio-voice/webhook`,
          });
          externalMeetingId = call.sid;
          // Voice calls have no joinUrl — dial-out is direct
          joinUrl = null;
        }
      } catch (err) {
        req.log.error({ err, provider }, 'Failed to create meeting with provider');
        return reply.code(503).send({ error: `Failed to start call via ${provider}` });
      }

      const session = await prisma.callSession.create({
        data: {
          orgId: auth.orgId,
          userId: auth.userId,
          entityType,
          entityId,
          provider,
          externalMeetingId,
          joinUrl,
          hostJoinUrl,
          status: 'SCHEDULED',
        },
        select: { id: true },
      });

      return reply.send({
        callSessionId: session.id,
        joinUrl,
        hostJoinUrl,
        provider,
      });
    },
  );

  /**
   * POST /calls/schedule
   * Creates a scheduled meeting with attendees and start time.
   */
  app.post(
    '/calls/schedule',
    {
      schema: {
        description: 'Schedule a video call for a CRM entity with attendees',
        tags: ['calls'],
        body: z.object({
          entityType: EntityTypeEnum,
          entityId: z.string().uuid(),
          provider: ProviderEnum.exclude(['TWILIO_VOICE']),
          startsAt: z.string().datetime(),
          durationMinutes: z.number().int().min(15).max(480).default(60),
          attendeeEmails: z.array(z.string().email()).max(50).default([]),
          topic: z.string().max(200).optional(),
        }),
        response: {
          200: z.object({
            callSessionId: z.string().uuid(),
            joinUrl: z.string().url().nullable(),
            provider: z.string(),
          }),
          503: z.object({ error: z.string() }),
        },
      },
    },
    async (req, reply) => {
      const auth = getAuth(req);
      const { entityType, entityId, provider, startsAt, durationMinutes, attendeeEmails, topic } =
        req.body;

      const title = topic ?? `${entityType} call`;

      let joinUrl: string | null = null;
      let hostJoinUrl: string | null = null;
      let externalMeetingId: string | null = null;

      try {
        if (provider === 'ZOOM') {
          const meeting = await createZoomMeeting({
            topic: title,
            startTime: startsAt,
            durationMinutes,
            attendeeEmails,
          });
          joinUrl = meeting.join_url;
          hostJoinUrl = meeting.start_url;
          externalMeetingId = String(meeting.id);
        } else if (provider === 'TEAMS') {
          const meeting = await createTeamsMeeting({
            orgId: auth.orgId,
            userId: auth.userId,
            subject: title,
            startTime: startsAt,
            durationMinutes,
            attendeeEmails,
          });
          joinUrl = meeting.joinWebUrl;
          externalMeetingId = meeting.id;
        } else if (provider === 'GOOGLE_MEET') {
          const event = await createGoogleMeetEvent({
            orgId: auth.orgId,
            userId: auth.userId,
            title,
            startTime: startsAt,
            durationMinutes,
            attendeeEmails,
          });
          joinUrl = event.hangoutLink;
          externalMeetingId = event.id;
        }
      } catch (err) {
        req.log.error({ err, provider }, 'Failed to schedule meeting with provider');
        return reply.code(503).send({ error: `Failed to schedule call via ${provider}` });
      }

      const session = await prisma.callSession.create({
        data: {
          orgId: auth.orgId,
          userId: auth.userId,
          entityType,
          entityId,
          provider,
          externalMeetingId,
          joinUrl,
          hostJoinUrl,
          scheduledAt: new Date(startsAt),
          participantEmails: attendeeEmails,
          status: 'SCHEDULED',
        },
        select: { id: true },
      });

      return reply.send({ callSessionId: session.id, joinUrl, provider });
    },
  );

  /**
   * GET /calls
   * Lists call sessions for an entity (most recent first).
   */
  app.get(
    '/calls',
    {
      schema: {
        description: 'List call sessions for a CRM entity',
        tags: ['calls'],
        querystring: z.object({
          entityType: EntityTypeEnum.optional(),
          entityId: z.string().uuid().optional(),
          provider: ProviderEnum.optional(),
          limit: z.coerce.number().int().min(1).max(100).default(25),
          cursor: z.string().uuid().optional(),
        }),
        response: {
          200: z.object({
            calls: z.array(CallSessionSchema),
            nextCursor: z.string().uuid().nullable(),
          }),
        },
      },
    },
    async (req, reply) => {
      const auth = getAuth(req);
      const { entityType, entityId, provider, limit, cursor } = req.query;

      const sessions = await prisma.callSession.findMany({
        where: {
          orgId: auth.orgId,
          ...(entityType ? { entityType } : {}),
          ...(entityId ? { entityId } : {}),
          ...(provider ? { provider } : {}),
          ...(cursor ? { id: { lt: cursor } } : {}),
        },
        orderBy: { scheduledAt: 'desc' },
        take: limit + 1,
        select: {
          id: true,
          orgId: true,
          userId: true,
          entityType: true,
          entityId: true,
          provider: true,
          externalMeetingId: true,
          joinUrl: true,
          scheduledAt: true,
          startedAt: true,
          endedAt: true,
          durationSec: true,
          participantEmails: true,
          recordingUrl: true,
          summary: true,
          actionItems: true,
          sentimentScore: true,
          talkRatio: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      const hasMore = sessions.length > limit;
      const page = hasMore ? sessions.slice(0, limit) : sessions;
      const nextCursor = hasMore ? (page[page.length - 1]?.id ?? null) : null;

      return reply.send({
        calls: page.map((s) => ({
          ...s,
          scheduledAt: s.scheduledAt?.toISOString() ?? null,
          startedAt: s.startedAt?.toISOString() ?? null,
          endedAt: s.endedAt?.toISOString() ?? null,
          createdAt: s.createdAt.toISOString(),
          updatedAt: s.updatedAt.toISOString(),
          // Strip stored recording key — signed URL served in GET /calls/:id
          recordingUrl: s.recordingUrl ? '[available]' : null,
        })),
        nextCursor,
      });
    },
  );

  /**
   * GET /calls/:id
   * Full call detail with fresh signed recording URL + transcript + summaries.
   */
  app.get(
    '/calls/:id',
    {
      schema: {
        description: 'Get full call session detail including transcript and AI insights',
        tags: ['calls'],
        params: z.object({ id: z.string().uuid() }),
        response: {
          200: z.object({
            call: CallSessionSchema.extend({
              transcriptText: z.string().nullable(),
              transcriptStructured: z.unknown().nullable(),
              signedRecordingUrl: z.string().nullable(),
              summaries: z.array(
                z.object({
                  id: z.string().uuid(),
                  key: z.string(),
                  value: z.string(),
                  confidence: z.number(),
                  sourceQuoteRef: z.string().nullable(),
                }),
              ),
            }),
          }),
          404: z.object({ error: z.string() }),
        },
      },
    },
    async (req, reply) => {
      const auth = getAuth(req);
      const { id } = req.params;

      const session = await prisma.callSession.findFirst({
        where: { id, orgId: auth.orgId },
        include: {
          callSummaries: {
            select: { id: true, key: true, value: true, confidence: true, sourceQuoteRef: true },
            orderBy: { createdAt: 'asc' },
          },
        },
      });

      if (!session) {
        return reply.code(404).send({ error: 'Call session not found' });
      }

      // Generate fresh signed URL if recording is stored in S3
      let signedRecordingUrl: string | null = null;
      if (session.recordingUrl && !session.recordingUrl.startsWith('http')) {
        // Stored as S3 object key (no http prefix) — sign it
        try {
          signedRecordingUrl = await getSignedRecordingUrl(session.recordingUrl);
        } catch (err) {
          req.log.warn({ err, callSessionId: id }, 'Failed to sign recording URL');
        }
      } else if (session.recordingUrl?.startsWith('http')) {
        // Already a full URL (e.g. not yet migrated to S3, or Zoom direct URL)
        signedRecordingUrl = session.recordingUrl;
      }

      return reply.send({
        call: {
          ...session,
          scheduledAt: session.scheduledAt?.toISOString() ?? null,
          startedAt: session.startedAt?.toISOString() ?? null,
          endedAt: session.endedAt?.toISOString() ?? null,
          createdAt: session.createdAt.toISOString(),
          updatedAt: session.updatedAt.toISOString(),
          recordingUrl: signedRecordingUrl ? '[signed]' : null,
          signedRecordingUrl,
          summaries: session.callSummaries,
        },
      });
    },
  );

  /**
   * POST /calls/:id/extract-insights
   * Manually re-triggers the AI analysis pass on an existing transcript.
   * Requires the call to already have transcriptText populated.
   */
  app.post(
    '/calls/:id/extract-insights',
    {
      schema: {
        description: 'Re-trigger AI analysis on an existing call transcript',
        tags: ['calls'],
        params: z.object({ id: z.string().uuid() }),
        response: {
          202: z.object({ jobId: z.string(), message: z.string() }),
          404: z.object({ error: z.string() }),
          409: z.object({ error: z.string() }),
        },
      },
    },
    async (req, reply) => {
      const auth = getAuth(req);
      const { id } = req.params;

      const session = await prisma.callSession.findFirst({
        where: { id, orgId: auth.orgId },
        select: { id: true, transcriptText: true, status: true },
      });

      if (!session) return reply.code(404).send({ error: 'Call session not found' });

      if (!session.transcriptText) {
        return reply
          .code(409)
          .send({ error: 'No transcript available. Wait for transcription to complete.' });
      }

      // Enqueue analysis job
      const queue = new Queue(CALL_ANALYZE.name, {
        connection: redis,
        defaultJobOptions: CALL_ANALYZE.defaultJobOptions,
      });

      const job = await queue.add('re-analyze', {
        callSessionId: id,
        orgId: auth.orgId,
      });

      return reply.code(202).send({
        jobId: job.id ?? 'queued',
        message: 'Analysis job enqueued. Results will be available within 30-60 seconds.',
      });
    },
  );
};

/**
 * calls.write.routes.ts — POST /calls/quick-start and POST /calls/schedule.
 *
 * Extracted from calls.ts (BS-R1 file-size refactor).
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
import { EntityTypeEnum, ProviderEnum, getAuth } from './calls.helpers.js';
import { tenantEntityBelongsToOrg } from '../lib/tenant-ownership.js';

/** Verify the target CRM entity belongs to the caller's org before spending on a
 *  provider call. DEAL is the opportunity alias. (Review finding, 2026-06-04.) */
async function assertEntityOwned(entityType: string, entityId: string, orgId: string): Promise<boolean> {
  const ownershipType = entityType === 'DEAL' ? 'opportunity' : entityType;
  return tenantEntityBelongsToOrg(ownershipType, entityId, orgId);
}

export const callsWriteRoutes: FastifyPluginAsync = async (fastify) => {
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

      if (!(await assertEntityOwned(entityType, entityId, auth.orgId))) {
        return reply.code(400).send({ error: 'Entity not found in your organization' });
      }

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
          400: z.object({ error: z.string() }),
          503: z.object({ error: z.string() }),
        },
      },
    },
    async (req, reply) => {
      const auth = getAuth(req);
      const { entityType, entityId, provider, startsAt, durationMinutes, attendeeEmails, topic } =
        req.body;

      if (!(await assertEntityOwned(entityType, entityId, auth.orgId))) {
        return reply.code(400).send({ error: 'Entity not found in your organization' });
      }

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
};

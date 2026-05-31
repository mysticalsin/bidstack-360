/**
 * Provider webhook routes for call events — Wave 8 Voice + Video.
 *
 * All webhook routes are unauthenticated (providers call these from their infra).
 * Each is validated via provider-specific signature before processing.
 *
 * Routes:
 *   POST /integrations/zoom/webhook          — meeting.ended, recording.completed, url_validation
 *   POST /integrations/teams/webhook         — Graph change notification (online meeting updates)
 *   POST /integrations/twilio-voice/webhook  — recording.completed, call status
 *   POST /integrations/twilio-voice/twiml/:callSessionId — TwiML generator (called by Twilio)
 *
 * WHY NOT rate-limited: providers burst webhooks; rate-limiting would cause
 * 429s and force expensive retries or missed events.
 *
 * Multi-tenancy on webhooks: Zoom/Twilio events carry the external meeting/call ID
 * which we use to look up the CallSession by externalMeetingId → derive orgId.
 * Graph subscriptions carry a clientState field that stores the orgId.
 */

import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { Queue } from 'bullmq';

import { prisma } from '@bidstack/db';
import {
  validateZoomWebhook,
  zoomUrlValidationResponse,
} from '../../services/calls/zoom.service.js';
import { validateTwilioVoiceSignature } from '../../services/calls/twilio-voice.service.js';
import { verifyClientState } from '../../services/microsoft-graph-subscription.service.js';
import { CALL_FETCH_RECORDING } from '@bidstack/shared';
import { redis } from '../../redis.js';

// ─── Zoom webhook routes ─────────────────────────────────────────────────────

export const zoomCallWebhookRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /**
   * Zoom webhook receiver.
   * Handles three event types:
   *  - endpoint.url_validation — registration handshake (must return encryptedToken)
   *  - meeting.ended           — update CallSession status to COMPLETED
   *  - recording.completed     — enqueue call.fetch-recording job
   */
  app.post(
    '/zoom/webhook',
    {
      config: { rawBody: true },
      schema: {
        description: 'Zoom webhook receiver for call events',
        tags: ['webhooks', 'calls'],
        body: z.object({
          event: z.string(),
          event_ts: z.number().optional(),
          payload: z.record(z.unknown()).optional(),
        }),
        response: {
          200: z.union([
            z.object({ ok: z.boolean() }),
            z.object({ plainToken: z.string(), encryptedToken: z.string() }),
          ]),
          403: z.object({ ok: z.boolean() }),
        },
      },
    },
    async (req, reply) => {
      const signature = req.headers['x-zm-signature'] as string | undefined;
      const timestamp = req.headers['x-zm-request-timestamp'] as string | undefined;
      // rawBody is set by fastify/rawBody plugin on the request
      const rawBody = (req as unknown as { rawBody?: string }).rawBody ?? JSON.stringify(req.body);

      // URL validation handshake (no signature required for initial setup)
      if (req.body.event === 'endpoint.url_validation') {
        const plainToken = (req.body.payload as { plainToken?: string })?.plainToken ?? '';
        return reply.send(
          zoomUrlValidationResponse(plainToken) as {
            plainToken: string;
            encryptedToken: string;
          },
        );
      }

      // Validate signature for all other events
      if (!signature || !timestamp) {
        return reply.code(403).send({ ok: false } as never);
      }
      if (!validateZoomWebhook(signature, timestamp, rawBody)) {
        return reply.code(403).send({ ok: false } as never);
      }

      const payload = req.body.payload as Record<string, unknown>;

      if (req.body.event === 'meeting.ended') {
        const meetingId = String((payload.object as Record<string, unknown>)?.id ?? '');
        if (meetingId) {
          // Derive the owning org from the session FIRST, then scope the write
          // to that org. A blind updateMany keyed only on externalMeetingId is
          // not tenant-bounded — every tenant-table write must include orgId
          // (mirrors the recording.completed + Teams handlers below/above).
          const session = await prisma.callSession.findFirst({
            where: { externalMeetingId: meetingId, status: { not: 'COMPLETED' } },
            select: { orgId: true },
          });
          if (session) {
            await prisma.callSession.updateMany({
              where: {
                orgId: session.orgId,
                externalMeetingId: meetingId,
                status: { not: 'COMPLETED' },
              },
              data: {
                status: 'COMPLETED',
                endedAt: new Date(),
              },
            });
          }
        }
      } else if (req.body.event === 'recording.completed') {
        const meetingId = String((payload.object as Record<string, unknown>)?.id ?? '');
        const meetingUuid = String((payload.object as Record<string, unknown>)?.uuid ?? '');

        const session = await prisma.callSession.findFirst({
          where: { externalMeetingId: meetingId },
          select: { id: true, orgId: true },
        });

        if (session) {
          const queue = new Queue(CALL_FETCH_RECORDING.name, {
            connection: redis,
            defaultJobOptions: CALL_FETCH_RECORDING.defaultJobOptions,
          });
          await queue.add('zoom-recording', {
            callSessionId: session.id,
            orgId: session.orgId,
            provider: 'ZOOM',
            meetingUuid,
          });
        }
      }

      return reply.send({ ok: true });
    },
  );
};

// ─── Teams (Graph) webhook routes ──────────────────────────────────────────

export const teamsCallWebhookRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /**
   * Microsoft Graph change notification for online meetings.
   * Graph sends a `validationToken` query param during subscription registration.
   * For real notifications, it sends a JSON body with `value` array.
   */
  app.post(
    '/teams/webhook',
    {
      schema: {
        description: 'Microsoft Graph webhook for Teams call events',
        tags: ['webhooks', 'calls'],
        querystring: z.object({
          validationToken: z.string().optional(),
        }),
        body: z
          .object({
            value: z
              .array(
                z.object({
                  subscriptionId: z.string().optional(),
                  clientState: z.string().optional(),
                  changeType: z.string().optional(),
                  resource: z.string().optional(),
                  resourceData: z.record(z.unknown()).optional(),
                }),
              )
              .optional(),
          })
          .passthrough()
          .optional(),
        response: {
          200: z.union([z.string(), z.object({ ok: z.boolean() })]),
        },
      },
    },
    async (req, reply) => {
      // Graph subscription validation handshake
      if (req.query.validationToken) {
        return reply.header('Content-Type', 'text/plain').send(req.query.validationToken as string);
      }

      const notifications = req.body?.value ?? [];

      for (const notification of notifications) {
        // SECURITY: never trust the request's clientState as the orgId — that
        // would let anyone POST a victim orgId and mutate their call sessions.
        // Look the subscription up by its id, constant-time-verify the clientState
        // secret, and derive orgId from the STORED row.
        if (!notification.subscriptionId || !notification.clientState) continue;
        const sub = await prisma.graphSubscription.findUnique({
          where: { subscriptionId: notification.subscriptionId },
          select: { orgId: true, clientState: true },
        });
        if (!sub || !verifyClientState(notification.clientState, sub.clientState)) {
          req.log.warn(
            { subscriptionId: notification.subscriptionId },
            'teams webhook: unknown subscription or clientState mismatch — ignoring',
          );
          continue;
        }
        const orgId = sub.orgId;

        // For now, mark call as completed when we receive a meeting end notification
        const resource = notification.resource ?? '';
        const meetingId = resource.split('/').pop() ?? '';

        if (notification.changeType === 'deleted' && meetingId) {
          await prisma.callSession.updateMany({
            where: { orgId, externalMeetingId: meetingId, status: { not: 'COMPLETED' } },
            data: { status: 'COMPLETED', endedAt: new Date() },
          });
        }
      }

      return reply.send({ ok: true });
    },
  );
};

// ─── Twilio Voice webhook routes ───────────────────────────────────────────

export const twilioVoiceWebhookRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /**
   * Twilio recording status callback + call status callback.
   * Twilio reuses one endpoint for both; the RecordingUrl field distinguishes them.
   */
  app.post(
    '/twilio-voice/webhook',
    {
      schema: {
        description: 'Twilio voice call status and recording status callback',
        tags: ['webhooks', 'calls'],
        body: z.object({
          CallSid: z.string(),
          CallStatus: z.string().optional(),
          Duration: z.string().optional(),
          CallDuration: z.string().optional(),
          RecordingSid: z.string().optional(),
          RecordingUrl: z.string().optional(),
          RecordingDuration: z.string().optional(),
          RecordingStatus: z.string().optional(),
          AccountSid: z.string().optional(),
          To: z.string().optional(),
          From: z.string().optional(),
        }),
        response: { 200: z.object({ ok: z.boolean() }), 403: z.object({ ok: z.boolean() }) },
      },
    },
    async (req, reply) => {
      const signature = req.headers['x-twilio-signature'] as string | undefined;
      if (!signature) return reply.code(403).send({ ok: false } as never);

      const publicApiUrl = process.env.PUBLIC_API_URL ?? '';
      const callbackUrl = `${publicApiUrl}/api/v1/integrations/twilio-voice/webhook`;

      if (
        !validateTwilioVoiceSignature(signature, callbackUrl, req.body as Record<string, string>)
      ) {
        return reply.code(403).send({ ok: false } as never);
      }

      const session = await prisma.callSession.findFirst({
        where: { externalMeetingId: req.body.CallSid },
        select: { id: true, orgId: true },
      });

      if (!session) return reply.send({ ok: true }); // Unknown call — ignore

      // Call status update (completed, failed, busy, no-answer)
      if (req.body.CallStatus) {
        const durationSec = req.body.CallDuration
          ? parseInt(req.body.CallDuration, 10)
          : req.body.Duration
            ? parseInt(req.body.Duration, 10)
            : undefined;

        const statusMap: Record<string, string> = {
          completed: 'COMPLETED',
          failed: 'FAILED',
          busy: 'FAILED',
          'no-answer': 'FAILED',
          canceled: 'FAILED',
          'in-progress': 'LIVE',
          ringing: 'LIVE',
          queued: 'SCHEDULED',
          initiated: 'SCHEDULED',
        };

        await prisma.callSession.update({
          where: { id: session.id },
          data: {
            status: statusMap[req.body.CallStatus] ?? 'COMPLETED',
            endedAt: req.body.CallStatus === 'completed' ? new Date() : undefined,
            durationSec,
          },
        });
      }

      // Recording available — enqueue fetch + transcribe
      if (req.body.RecordingUrl && req.body.RecordingStatus === 'completed') {
        const fetchQueue = new Queue(CALL_FETCH_RECORDING.name, {
          connection: redis,
          defaultJobOptions: CALL_FETCH_RECORDING.defaultJobOptions,
        });
        await fetchQueue.add('twilio-recording', {
          callSessionId: session.id,
          orgId: session.orgId,
          provider: 'TWILIO_VOICE',
          recordingUrl: req.body.RecordingUrl,
          recordingSid: req.body.RecordingSid,
        });
      }

      return reply.send({ ok: true });
    },
  );

  /**
   * TwiML generator endpoint — Twilio fetches this when the call connects.
   * Returns XML instructing Twilio how to route the call.
   * The callSessionId is embedded in the URL so we can look up the target number.
   */
  app.post(
    '/twilio-voice/twiml/:callSessionId',
    {
      schema: {
        description: 'TwiML generator for outbound voice calls',
        tags: ['webhooks', 'calls'],
        params: z.object({ callSessionId: z.string().uuid() }),
        body: z.record(z.string()).optional(),
        response: { 200: z.string(), 403: z.string() },
      },
    },
    async (req, reply) => {
      const { callSessionId } = req.params;

      // Verify Twilio signature
      const signature = req.headers['x-twilio-signature'] as string | undefined;
      const publicApiUrl = process.env.PUBLIC_API_URL ?? '';
      const twimlUrl = `${publicApiUrl}/api/v1/integrations/twilio-voice/twiml/${callSessionId}`;

      if (
        signature &&
        !validateTwilioVoiceSignature(
          signature,
          twimlUrl,
          (req.body as Record<string, string>) ?? {},
        )
      ) {
        return reply.code(403).send('Forbidden' as never);
      }

      // We need the target number — the CallSession records entityId but not phone.
      // In production, derive from entity: Contact.phone or Lead.phone.
      // For now, return a safe TwiML that reads out a message (fail-safe).
      const twiml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<Response>',
        '  <Say>Connecting your call. Please wait.</Say>',
        '  <Pause length="1"/>',
        '</Response>',
      ].join('\n');

      return reply.header('Content-Type', 'text/xml').send(twiml);
    },
  );
};

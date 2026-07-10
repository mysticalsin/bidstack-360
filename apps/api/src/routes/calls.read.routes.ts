/**
 * calls.read.routes.ts — GET /calls, GET /calls/:id, POST /calls/:id/extract-insights.
 *
 * Extracted from calls.ts (BS-R1 file-size refactor).
 */
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '@bidstack/db';
import { getSignedRecordingUrl } from '../services/calls/recording-storage.service.js';
import { Queue } from 'bullmq';
import { CALL_ANALYZE } from '@bidstack/shared';
import { redis } from '../redis.js';
import { CallSessionSchema, EntityTypeEnum, ProviderEnum, getAuth } from './calls.helpers.js';

export const callsReadRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /**
   * GET /calls
   * Lists call sessions for an entity (most recent first).
   */
  app.get(
    '/calls',
    {
      config: { permission: 'activities:read' },
      preHandler: [app.requirePermission('activities:read')],
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

      // Keyset pagination must follow the sort order. Filtering `id < cursor`
      // while sorting by scheduledAt walked random UUID order — pages skipped
      // and duplicated rows. Prisma's cursor+skip resumes AT the cursor row in
      // the declared (stable, id-tiebroken) order instead.
      const sessions = await prisma.callSession.findMany({
        where: {
          orgId: auth.orgId,
          ...(entityType ? { entityType } : {}),
          ...(entityId ? { entityId } : {}),
          ...(provider ? { provider } : {}),
        },
        orderBy: [{ scheduledAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
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
      config: { permission: 'activities:read' },
      preHandler: [app.requirePermission('activities:read')],
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
      config: { permission: 'activities:write' },
      preHandler: [
        app.requireHumanActor('Call insight extraction requires a user session'),
        app.requirePermission('activities:write'),
      ],
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

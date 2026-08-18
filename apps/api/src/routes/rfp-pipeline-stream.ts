// RFP pipeline — SSE stream route for real-time pipeline phase progress.
//
// GET /bid-workspaces/:workspaceId/rfp/:orchestrationId/stream
//
// Streams orchestration state transitions via Server-Sent Events.
// Polls the DB every 2 s until terminal state or 30-minute hard deadline.
//
// WHY polling instead of Postgres LISTEN/NOTIFY: the worker already writes
// state transitions to the rfp_orchestrations row; polling is simpler and
// avoids a long-lived PG connection per SSE client. Revisit with
// LISTEN/NOTIFY if > 500 concurrent SSE clients become a concern.
//
// Constants + schemas → rfp-pipeline.helpers.ts
// Upload / autofill / approve routes → rfp-pipeline.ts

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { prisma } from '@bidstack/db';
import { buildAllowedCorsOrigins, isLoopbackOrigin } from '../lib/cors-origins.js';
import { createLogger } from '../lib/logger.js';
import {
  StreamParams,
  SSE_POLL_INTERVAL_MS,
  SSE_HEARTBEAT_INTERVAL_MS,
  SSE_MAX_POLL_MS,
  SSE_TERMINAL_STATES,
  writeSseEvent,
} from './rfp-pipeline.helpers.js';

const log = createLogger({ name: 'rfp-pipeline-stream' });

export const rfpPipelineStreamRoutes: FastifyPluginAsyncZod = async (server) => {
  server.get(
    '/bid-workspaces/:workspaceId/rfp/:orchestrationId/stream',
    {
      config: { permission: 'documents:read' },
      preHandler: server.requirePermission('documents:read'),
      schema: { params: StreamParams },
    },
    async (req, reply) => {
      const { orgId } = req.auth;

      // Verify the orchestration belongs to this org and workspace.
      const initial = await prisma.rfpOrchestration.findFirst({
        where: {
          id: req.params.orchestrationId,
          orgId,
          opportunityId: req.params.workspaceId,
          deletedAt: null,
        },
        select: {
          id: true,
          state: true,
          currentPhase: true,
          completedPhases: true,
          failureReason: true,
          updatedAt: true,
        },
      });
      if (!initial) throw server.httpErrors.notFound('RFP orchestration not found');

      // Switch to SSE mode.
      // §SSE-CORS — must never fall back to wildcard ('*').
      // Wildcard + credentials (cookies / Authorization header) is rejected by browsers
      // AND exposes the SSE stream to any origin. Fail-closed: if PUBLIC_BASE_URL is
      // not set in production, return 500 rather than silently open the stream to all.
      const allowedOrigins = buildAllowedCorsOrigins(
        process.env.PUBLIC_BASE_URL,
        process.env.NODE_ENV ?? 'development',
        process.env.CORS_EXTRA_ORIGINS,
      );
      const requestOrigin = req.headers.origin;
      const allowedOrigin =
        typeof requestOrigin === 'string' && allowedOrigins.includes(requestOrigin)
          ? requestOrigin
          : allowedOrigins[0];
      if (!allowedOrigin) {
        throw server.httpErrors.internalServerError(
          'SSE stream misconfigured: PUBLIC_BASE_URL env var is required in production',
        );
      }
      if ((process.env.NODE_ENV ?? 'development') === 'production' && isLoopbackOrigin(allowedOrigin)) {
        throw server.httpErrors.forbidden('SSE stream origin rejected');
      }
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': allowedOrigin,
        Vary: 'Origin', // don't let a shared cache serve this ACAO to another origin
        'X-Accel-Buffering': 'no', // disable Nginx buffering for SSE
      });

      // Send initial state immediately so the client doesn't wait for the first poll.
      // WHY these exact keys: the SSE consumer is useRfpPipeline()'s ServerSseFrame
      // (apps/web/src/hooks/rfp/useRfpPipeline.ts), which reads phase/state/updatedAt/
      // progress/message/error and DERIVES the UI stage from `phase` — because `state`
      // stays 'running' for the entire active pipeline. Emitting the store's
      // PipelineEvent keys (stage/timestamp) here instead leaves frame.phase and
      // frame.updatedAt undefined, which freezes the UI on "extracting" and renders
      // "Invalid Date" in the activity feed. Keep this aligned with ServerSseFrame.
      writeSseEvent(reply, {
        phase: initial.currentPhase,
        state: initial.state,
        message: initial.currentPhase ?? 'Pipeline started',
        updatedAt: initial.updatedAt.toISOString(),
        progress: initial.completedPhases.length,
        ...(initial.failureReason ? { error: initial.failureReason } : {}),
      });

      if (SSE_TERMINAL_STATES.has(initial.state)) {
        reply.raw.end();
        return reply;
      }

      let closed = false;
      req.raw.on('close', () => {
        closed = true;
      });

      await new Promise<void>((resolve) => {
        const deadline = Date.now() + SSE_MAX_POLL_MS;

        // Heartbeat: SSE comment every 30 s prevents proxy/LB idle-connection timeout.
        // WHY comment not data event: a comment (': ping\n\n') is ignored by
        // EventSource's onmessage handler — no spurious dispatches to the client.
        const heartbeatTimer = setInterval(() => {
          if (!closed) reply.raw.write(': ping\n\n');
        }, SSE_HEARTBEAT_INTERVAL_MS);

        const cleanup = (endStream: boolean) => {
          clearInterval(heartbeatTimer);
          if (endStream) reply.raw.end();
          resolve();
        };

        const tick = async () => {
          if (closed) return cleanup(false);

          // MAX_POLL_TIME guard: hard deadline prevents eternal connection on stuck jobs.
          if (Date.now() >= deadline) {
            log.warn(
              { orchestrationId: req.params.orchestrationId, orgId },
              'SSE stream closed — max poll duration (30 min) reached',
            );
            writeSseEvent(reply, {
              phase: null,
              state: 'timeout',
              message: 'Stream closed after maximum duration. Reconnect to continue monitoring.',
              updatedAt: new Date().toISOString(),
              error: 'SSE stream timed out after 30 minutes',
            });
            return cleanup(true);
          }

          let row: {
            state: string;
            currentPhase: string | null;
            completedPhases: string[];
            failureReason: string | null;
            updatedAt: Date;
          } | null;
          try {
            row = await prisma.rfpOrchestration.findFirst({
              where: {
                id: req.params.orchestrationId,
                orgId,
                deletedAt: null,
              },
              select: {
                state: true,
                currentPhase: true,
                completedPhases: true,
                failureReason: true,
                updatedAt: true,
              },
            });
          } catch (dbErr) {
            req.log.error(
              { err: dbErr, orchestrationId: req.params.orchestrationId },
              'SSE poll DB error',
            );
            // state:'failed' (not 'error') so the client's STATE_TO_STAGE maps it
            // to the failed UI stage — 'error' is unmapped and would fall back to
            // 'extracting', masking the failure.
            writeSseEvent(reply, {
              phase: null,
              state: 'failed',
              message: 'Database error while polling orchestration status',
              updatedAt: new Date().toISOString(),
              error: 'Internal database error',
            });
            return cleanup(true);
          }

          if (!row || closed) return cleanup(false);

          writeSseEvent(reply, {
            phase: row.currentPhase,
            state: row.state,
            message: row.currentPhase ?? 'Processing',
            updatedAt: row.updatedAt.toISOString(),
            progress: row.completedPhases.length,
            ...(row.failureReason ? { error: row.failureReason } : {}),
          });

          if (SSE_TERMINAL_STATES.has(row.state)) {
            return cleanup(true);
          }

          setTimeout(() => {
            void tick();
          }, SSE_POLL_INTERVAL_MS);
        };

        setTimeout(() => {
          void tick();
        }, SSE_POLL_INTERVAL_MS);
      });

      return reply;
    },
  );
};

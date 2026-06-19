import { timingSafeEqual } from 'node:crypto';

import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { enqueueSentrySmoke } from '../queues/sentry-smoke.js';

const API_SMOKE_MARKER = 'bidstack-api-sentry-smoke';
const WORKER_SMOKE_MARKER = 'bidstack-worker-sentry-smoke';
const SMOKE_TOKEN_HEADER = 'x-bidstack-sentry-smoke-token';
const SmokeRequest = z.object({
  marker: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-zA-Z0-9_.:@+-]+$/)
    .optional(),
});
const WorkerSmokeResponse = z.object({
  queued: z.boolean(),
  jobId: z.string(),
  marker: z.string(),
  release: z.string(),
  environment: z.string(),
});

type SmokeRequest = z.infer<typeof SmokeRequest>;

function constantTimeEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(actualBuffer, expectedBuffer);
}

function readSmokeToken(req: FastifyRequest): string {
  const header = req.headers[SMOKE_TOKEN_HEADER];
  const rawHeader = Array.isArray(header) ? header[0] : header;
  if (typeof rawHeader === 'string' && rawHeader.trim()) return rawHeader.trim();

  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    return auth.slice('Bearer '.length).trim();
  }
  return '';
}

function assertSmokeAuthorized(req: FastifyRequest): void {
  if (process.env.SENTRY_SMOKE_ENABLED !== 'true') {
    throw req.server.httpErrors.notFound('Not found');
  }
  if (!process.env.SENTRY_DSN) {
    throw req.server.httpErrors.serviceUnavailable('SENTRY_DSN is required for Sentry smoke');
  }
  if (!process.env.SENTRY_RELEASE) {
    throw req.server.httpErrors.serviceUnavailable('SENTRY_RELEASE is required for Sentry smoke');
  }

  const expected = process.env.SENTRY_SMOKE_TOKEN ?? '';
  if (expected.length < 24) {
    throw req.server.httpErrors.serviceUnavailable(
      'SENTRY_SMOKE_TOKEN must be at least 24 characters',
    );
  }
  if (!constantTimeEqual(readSmokeToken(req), expected)) {
    throw req.server.httpErrors.unauthorized('Invalid Sentry smoke token');
  }
}

function markerOrDefault(body: SmokeRequest, fallback: string): string {
  return body.marker?.trim() || fallback;
}

function smokeContext(marker: string) {
  return {
    marker,
    release: process.env.SENTRY_RELEASE ?? 'unknown-release',
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development',
  };
}

export const opsSentrySmokeRoutes: FastifyPluginAsyncZod = async (server) => {
  server.post(
    '/ops/sentry-smoke/api',
    {
      config: { public: true },
      schema: {
        summary: 'Trigger a controlled API Sentry smoke event',
        tags: ['ops'],
        body: SmokeRequest,
      },
    },
    async (req) => {
      assertSmokeAuthorized(req);
      const context = smokeContext(markerOrDefault(req.body, API_SMOKE_MARKER));
      throw new Error(
        `[${API_SMOKE_MARKER}] marker=${context.marker} release=${context.release} environment=${context.environment}`,
      );
    },
  );

  server.post(
    '/ops/sentry-smoke/worker',
    {
      config: { public: true },
      schema: {
        summary: 'Queue a controlled worker Sentry smoke failure',
        tags: ['ops'],
        body: SmokeRequest,
        response: {
          202: WorkerSmokeResponse,
        },
      },
    },
    async (req, reply) => {
      assertSmokeAuthorized(req);
      const context = smokeContext(markerOrDefault(req.body, WORKER_SMOKE_MARKER));
      const jobId = await enqueueSentrySmoke({
        ...context,
        triggeredAt: new Date().toISOString(),
      });
      if (!jobId) {
        throw req.server.httpErrors.serviceUnavailable('Could not enqueue Sentry worker smoke job');
      }

      return reply.code(202).send({
        queued: true,
        jobId,
        ...context,
      });
    },
  );
};

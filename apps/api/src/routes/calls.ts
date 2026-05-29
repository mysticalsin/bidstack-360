/**
 * calls.ts — call management route barrel (BS-R1 file-size refactor).
 *
 * Registers sub-plugins so server.ts import stays unchanged:
 *   calls.write.routes.ts — POST /calls/quick-start, POST /calls/schedule
 *   calls.read.routes.ts  — GET /calls, GET /calls/:id, POST /calls/:id/extract-insights
 *
 * Multi-tenancy: every query in sub-plugins includes orgId from req.auth.
 * WHY separate from webhook routes: authenticated calls are rate-limited and
 * go through authPlugin; webhooks are unauthenticated, validated via provider
 * signatures, and must NOT be rate-limited to the API bucket (providers burst).
 */
import type { FastifyPluginAsync } from 'fastify';

import { callsWriteRoutes } from './calls.write.routes.js';
import { callsReadRoutes } from './calls.read.routes.js';

export const callsRoutes: FastifyPluginAsync = async (fastify) => {
  await fastify.register(callsWriteRoutes);
  await fastify.register(callsReadRoutes);
};

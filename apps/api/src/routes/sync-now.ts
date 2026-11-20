// "Sync now" for pull sources (Dust, HubSpot): start a run, poll it, read the
// last sync time. A run is a BullMQ job (Dust) or a set of MigrationJobs
// (HubSpot) keyed by the caller's Idempotency-Key, so a double click or a
// retried request lands on the same run.
//
//   GET  /api/v1/sync-now/:source               integrations:read
//   POST /api/v1/sync-now/:source               dust: integrations:write
//                                               hubspot: settings:write, human only
//   GET  /api/v1/sync-now/:source/runs/:runId   integrations:read

import { randomUUID } from 'node:crypto';

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { SyncOverview, SyncRun, SyncSource } from '@bidstack/shared';

import { SyncNotFoundError, SyncUnavailableError } from '../services/sync-now/errors.js';
import { getSyncOverview, getSyncRun, startSyncRun } from '../services/sync-now/index.js';

const SourceParams = z.object({ source: SyncSource });

export const syncNowRoutes: FastifyPluginAsyncZod = async (server) => {
  const toHttp = (err: unknown): never => {
    if (err instanceof SyncNotFoundError) throw server.httpErrors.notFound(err.message);
    if (err instanceof SyncUnavailableError) throw server.httpErrors.badRequest(err.message);
    throw err;
  };

  server.get(
    '/sync-now/:source',
    {
      config: { permission: 'integrations:read' },
      schema: {
        tags: ['Integrations'],
        params: SourceParams,
        response: { 200: SyncOverview },
      },
    },
    async (req) => getSyncOverview(req.params.source, req.auth.orgId).catch(toHttp),
  );

  server.post(
    '/sync-now/:source',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      preHandler: async (req) => {
        const { source } = req.params as { source: string };
        // HubSpot imports record the importing user on every MigrationJob, so
        // only a signed-in admin may start one; Dust polls accept API keys.
        if (source === 'hubspot') {
          await server.requirePermission('settings:write')(req);
          await server.requireHumanActor('HubSpot import requires a user session')(req);
        } else {
          await server.requirePermission('integrations:write')(req);
        }
      },
      schema: {
        tags: ['Integrations'],
        params: SourceParams,
        body: z.object({}).strict().optional(),
        response: { 202: SyncRun },
      },
    },
    async (req, reply) => {
      const header = req.headers['idempotency-key'];
      const idempotencyKey =
        typeof header === 'string' && header.length >= 8 ? header : randomUUID();
      const run = await startSyncRun(req.params.source, {
        orgId: req.auth.orgId,
        userId: req.auth.userId,
        idempotencyKey,
      }).catch(toHttp);
      return reply.code(202).send(run);
    },
  );

  server.get(
    '/sync-now/:source/runs/:runId',
    {
      config: { permission: 'integrations:read' },
      schema: {
        tags: ['Integrations'],
        params: SourceParams.extend({ runId: z.string().min(1).max(80) }),
        response: { 200: SyncRun },
      },
    },
    async (req) => getSyncRun(req.params.source, req.auth.orgId, req.params.runId).catch(toHttp),
  );
};

// HubSpot OAuth + import migration routes.
//
// Endpoints:
//   GET  /api/v1/migrations/hubspot/auth       — initiate HubSpot OAuth flow
//   GET  /api/v1/migrations/hubspot/callback   — HubSpot OAuth callback (public)
//   POST /api/v1/migrations/start-hubspot      — start HubSpot import after OAuth
//
// Core CSV/generic migration routes → migrations.ts
// Serializers → migrations.helpers.ts

import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma, type Prisma } from '@bidstack/db';
import { MigrationJobResponse, DedupStrategyEnum, MIGRATION } from '@bidstack/shared';
import { encryptSecret, decryptSecret } from '@bidstack/shared/server-crypto';
import {
  buildHubSpotAuthUrl,
  exchangeHubSpotCode,
  countHubSpotObject,
  probeHubSpotConnection,
  type HubSpotTokens,
} from '../lib/hubspot-client.js';
import { recordSerumConnectorTestSuccess } from '../lib/serum-connector-policy.js';
import { HubspotNotConnectedError, startHubspotImport } from '../services/hubspot-import.js';
import { serializeJob } from './migrations.helpers.js';

export const HUBSPOT_INTEGRATION_TYPE = 'hubspot' as const;
export const HUBSPOT_MIGRATION_CONFIG_NAME = 'hubspot-migration' as const;

export function hubspotIntegrationConfigKey(
  orgId: string,
): Prisma.IntegrationConfigWhereUniqueInput {
  return {
    orgId_type_name: {
      orgId,
      type: HUBSPOT_INTEGRATION_TYPE,
      name: HUBSPOT_MIGRATION_CONFIG_NAME,
    },
  };
}

export function hubspotIntegrationConfigWhere(orgId: string): Prisma.IntegrationConfigWhereInput {
  return {
    orgId,
    type: HUBSPOT_INTEGRATION_TYPE,
    name: HUBSPOT_MIGRATION_CONFIG_NAME,
    isActive: true,
  };
}

export { buildHubSpotMigrationPayload } from '../services/hubspot-import.js';

export const hubspotMigrationRoutes: FastifyPluginAsyncZod = async (server) => {
  // BullMQ queue handle (producer side only — worker consumes).
  // Lazily initialised so the test environment doesn't need Redis configured.
  let migrationQueue: Queue | null = null;
  const getQueue = () => {
    if (!migrationQueue) {
      const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6380', {
        maxRetriesPerRequest: null,
        enableOfflineQueue: true,
        lazyConnect: false,
      });
      connection.on('error', (err) => {
        server.log.error({ err }, 'Redis connection error in HubSpot migration queue');
      });
      migrationQueue = new Queue(MIGRATION.name, {
        connection,
        defaultJobOptions: MIGRATION.defaultJobOptions as never,
      });
    }
    return migrationQueue;
  };

  // ─── HubSpot OAuth: initiate ───────────────────────────────────────────

  server.get(
    '/migrations/hubspot/auth',
    { config: { permission: 'settings:write' }, schema: { response: { 302: z.null() } } },
    async (req, reply) => {
      const clientId = process.env.HUBSPOT_CLIENT_ID;
      const redirectUri = process.env.HUBSPOT_REDIRECT_URI;

      if (!clientId || !redirectUri) {
        throw server.httpErrors.serviceUnavailable(
          'HubSpot OAuth not configured — set HUBSPOT_CLIENT_ID and HUBSPOT_REDIRECT_URI',
        );
      }

      // Encode orgId + userId in state so the callback can reconstruct auth
      // context. Authenticated-encrypt it (AES-256-GCM, base64url) so it can't be
      // forged or tampered — otherwise anyone could craft a state carrying a
      // victim's orgId and bind their own HubSpot tokens into that org on callback.
      const { orgId, userId } = req.auth;
      const state = encryptSecret(JSON.stringify({ orgId, userId, ts: Date.now() }));

      const authUrl = buildHubSpotAuthUrl(clientId, redirectUri, state);
      return reply.redirect(authUrl, 302);
    },
  );

  // ─── HubSpot OAuth: callback ───────────────────────────────────────────

  server.get(
    '/migrations/hubspot/callback',
    {
      // auth is embedded in state param
      config: { public: true, rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        querystring: z.object({
          code: z.string().min(1),
          state: z.string().min(1),
        }),
      },
    },
    async (req, reply) => {
      const { code, state } = req.query;
      const clientId = process.env.HUBSPOT_CLIENT_ID;
      const clientSecret = process.env.HUBSPOT_CLIENT_SECRET;
      const redirectUri = process.env.HUBSPOT_REDIRECT_URI;

      if (!clientId || !clientSecret || !redirectUri) {
        throw server.httpErrors.serviceUnavailable('HubSpot OAuth not configured');
      }

      // Verify state param (decode and check ts is < 10 minutes old).
      let stateData: { orgId: string; userId: string; ts: number };
      try {
        // decryptSecret throws on a forged/tampered blob (GCM auth-tag failure),
        // so orgId/userId below are guaranteed to be what WE encrypted at initiate.
        stateData = JSON.parse(decryptSecret(state)) as {
          orgId: string;
          userId: string;
          ts: number;
        };
      } catch {
        throw server.httpErrors.badRequest('Invalid OAuth state parameter');
      }

      if (Date.now() - stateData.ts > 600_000) {
        throw server.httpErrors.unprocessableEntity('OAuth state expired — please try again');
      }

      // Exchange code for tokens.
      let tokens: HubSpotTokens;
      try {
        tokens = await exchangeHubSpotCode(code, clientId, clientSecret, redirectUri);
      } catch (err) {
        throw server.httpErrors.badGateway(
          `HubSpot token exchange failed: ${err instanceof Error ? err.message : 'unknown error'}`,
        );
      }

      // Encrypt tokens before storing.
      const encrypted = encryptSecret(
        JSON.stringify({
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresAt: tokens.expiresAt,
        }),
      );

      let connectionProbe: { companyProbeOk: boolean } | null = null;
      try {
        connectionProbe = await probeHubSpotConnection(tokens.accessToken);
      } catch (err) {
        server.log.warn({ err }, 'HubSpot connection probe failed; evidence not recorded');
      }

      // Get entity counts for discovery page.
      const [companies, contacts, deals, tasks] = await Promise.all([
        countHubSpotObject(tokens.accessToken, 'companies'),
        countHubSpotObject(tokens.accessToken, 'contacts'),
        countHubSpotObject(tokens.accessToken, 'deals'),
        countHubSpotObject(tokens.accessToken, 'tasks'),
      ]);

      // Store encrypted tokens in IntegrationConfig (reuse existing model).
      await prisma.integrationConfig.upsert({
        where: hubspotIntegrationConfigKey(stateData.orgId),
        create: {
          orgId: stateData.orgId,
          type: HUBSPOT_INTEGRATION_TYPE,
          name: HUBSPOT_MIGRATION_CONFIG_NAME,
          config: { provider: 'hubspot', discovery: { companies, contacts, deals, tasks } },
          credentials: { encrypted },
          isActive: true,
        },
        update: {
          config: { provider: 'hubspot', discovery: { companies, contacts, deals, tasks } },
          credentials: { encrypted },
          isActive: true,
          updatedAt: new Date(),
        },
      });

      await prisma.auditLog.create({
        data: {
          orgId: stateData.orgId,
          userId: stateData.userId,
          action: 'migration.hubspot.connect',
          targetType: 'IntegrationConfig',
          targetId: null,
          diff: { discovery: { companies, contacts, deals, tasks } },
        },
      });

      if (connectionProbe) {
        await recordSerumConnectorTestSuccess({
          orgId: stateData.orgId,
          connectorId: 'hubspot',
          operation: 'hubspot.oauth.callback',
          testedByUserId: stateData.userId,
          evidence: { companies, contacts, deals, tasks },
        });
      }

      // Redirect to frontend migration page with discovery data.
      const frontendUrl = process.env.PUBLIC_BASE_URL ?? 'http://localhost:5173';
      const params = new URLSearchParams({
        hubspot: 'connected',
        companies: String(companies),
        contacts: String(contacts),
        deals: String(deals),
        tasks: String(tasks),
      });
      return reply.redirect(`${frontendUrl}/migrations?${params.toString()}`, 302);
    },
  );

  // ─── Start HubSpot import ──────────────────────────────────────────────

  server.post(
    '/migrations/start-hubspot',
    {
      // Bulk import (creates companies/contacts/deals/tasks). migrations.ts
      // gates all non-GET on settings:write; this sibling file had no RBAC gate.
      preHandler: [server.requirePermission('settings:write')],
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
      schema: {
        body: z.object({
          // Which entity types to import (user toggled these on discovery page).
          entities: z.array(z.enum(['companies', 'contacts', 'deals', 'tasks'])).min(1),
          dedupStrategy: DedupStrategyEnum.default('update'),
        }),
        response: { 201: z.object({ jobs: z.array(MigrationJobResponse) }) },
      },
    },
    async (req, reply) => {
      const { orgId, userId } = req.auth;
      try {
        const jobs = await startHubspotImport({
          orgId,
          userId,
          entities: req.body.entities,
          dedupStrategy: req.body.dedupStrategy,
          queue: getQueue(),
          log: req.log,
        });
        return reply.code(201).send({ jobs: jobs.map(serializeJob) });
      } catch (err) {
        if (err instanceof HubspotNotConnectedError)
          throw server.httpErrors.badRequest(err.message);
        throw err;
      }
    },
  );
};

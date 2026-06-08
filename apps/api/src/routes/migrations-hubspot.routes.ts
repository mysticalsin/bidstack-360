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
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '@bidstack/db';
import {
  MigrationJobResponse,
  DedupStrategyEnum,
  type MigrationJobPayload,
  HUBSPOT_COMPANY_DEFAULTS,
  HUBSPOT_CONTACT_DEFAULTS,
  HUBSPOT_DEAL_DEFAULTS,
  MIGRATION,
} from '@bidstack/shared';
import { encryptSecret, decryptSecret } from '@bidstack/shared/server-crypto';
import {
  buildHubSpotAuthUrl,
  exchangeHubSpotCode,
  countHubSpotObject,
  type HubSpotTokens,
} from '../lib/hubspot-client.js';
import { serializeJob } from './migrations.helpers.js';

export const hubspotMigrationRoutes: FastifyPluginAsyncZod = async (server) => {
  // BullMQ queue handle (producer side only — worker consumes).
  // Lazily initialised so the test environment doesn't need Redis configured.
  let migrationQueue: Queue | null = null;
  const getQueue = () => {
    if (!migrationQueue) {
      const { redis } = server as unknown as {
        redis: { status: string; duplicate: () => unknown };
      };
      migrationQueue = new Queue(MIGRATION.name, {
        connection: (redis as unknown as { duplicate: () => unknown }).duplicate() as never,
        defaultJobOptions: MIGRATION.defaultJobOptions as never,
      });
    }
    return migrationQueue;
  };

  // ─── HubSpot OAuth: initiate ───────────────────────────────────────────

  server.get(
    '/migrations/hubspot/auth',
    { schema: { response: { 302: z.null() } } },
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
      config: { public: true }, // auth is embedded in state param
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

      // Get entity counts for discovery page.
      const [companies, contacts, deals, tasks] = await Promise.all([
        countHubSpotObject(tokens.accessToken, 'companies'),
        countHubSpotObject(tokens.accessToken, 'contacts'),
        countHubSpotObject(tokens.accessToken, 'deals'),
        countHubSpotObject(tokens.accessToken, 'tasks'),
      ]);

      // Store encrypted tokens in IntegrationConfig (reuse existing model).
      await prisma.integrationConfig.upsert({
        where: {
          orgId_type_name: {
            orgId: stateData.orgId,
            type: 'salesforce', // closest existing enum value; TODO: add 'hubspot' to enum
            name: 'hubspot-migration',
          },
        },
        create: {
          orgId: stateData.orgId,
          type: 'salesforce', // see TODO above
          name: 'hubspot-migration',
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

      // Fetch stored encrypted tokens.
      const config = await prisma.integrationConfig.findFirst({
        where: { orgId, name: 'hubspot-migration', isActive: true },
      });
      if (!config) {
        throw server.httpErrors.badRequest('HubSpot not connected — complete OAuth flow first');
      }

      const credentials = config.credentials as Record<string, unknown>;
      let tokens: HubSpotTokens;
      try {
        tokens = JSON.parse(decryptSecret(credentials.encrypted as string)) as HubSpotTokens;
      } catch {
        throw server.httpErrors.serviceUnavailable('Failed to decrypt HubSpot tokens');
      }

      const entityMappings: Record<string, Record<string, string | null>> = {
        companies: HUBSPOT_COMPANY_DEFAULTS,
        contacts: HUBSPOT_CONTACT_DEFAULTS,
        deals: HUBSPOT_DEAL_DEFAULTS,
        tasks: {},
      };

      const queue = getQueue();
      const jobs: Awaited<ReturnType<typeof prisma.migrationJob.create>>[] = [];

      for (const entity of req.body.entities) {
        const discovery = (config.config as Record<string, unknown>).discovery as Record<
          string,
          number
        >;
        const totalRows = discovery?.[entity] ?? 0;

        const job = await prisma.migrationJob.create({
          data: {
            orgId,
            userId,
            source: 'HUBSPOT_OAUTH',
            status: 'RUNNING',
            startedAt: new Date(),
            totalRows,
            meta: { entityType: entity },
          },
        });

        // Save mappings.
        await prisma.migrationMapping.upsert({
          where: {
            orgId_source_sourceEntity: { orgId, source: 'HUBSPOT_OAUTH', sourceEntity: entity },
          },
          create: {
            orgId,
            source: 'HUBSPOT_OAUTH',
            sourceEntity: entity,
            mappings: entityMappings[entity] ?? {},
          },
          update: { mappings: entityMappings[entity] ?? {} },
        });

        // Enqueue first chunk — worker paginates via hubspotAfter cursor.
        const payload: MigrationJobPayload = {
          migrationJobId: job.id,
          orgId,
          userId,
          source: 'HUBSPOT_OAUTH',
          entityType: entity,
          chunkOffset: 0,
          chunkSize: 100,
          totalRows,
          mappings: entityMappings[entity] ?? {},
          dedupStrategy: req.body.dedupStrategy,
          externalIdColumn: 'hs_object_id',
          // Token forwarded in meta; worker refreshes if near expiry.
          meta: {
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            expiresAt: tokens.expiresAt,
          },
        };

        await queue.add(`${job.id}-chunk-0`, payload, {
          jobId: `${job.id}-${entity}-chunk-0`,
        });

        await prisma.auditLog.create({
          data: {
            orgId,
            userId,
            action: 'migration.start',
            targetType: 'MigrationJob',
            targetId: job.id,
            diff: { source: 'HUBSPOT_OAUTH', entityType: entity, totalRows },
          },
        });

        jobs.push(job);
      }

      return reply.code(201).send({ jobs: jobs.map(serializeJob) });
    },
  );
};

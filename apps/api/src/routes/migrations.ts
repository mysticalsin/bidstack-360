// Migration connector routes.
//
// Endpoints:
//   GET    /api/v1/migrations                      — list jobs for org
//   GET    /api/v1/migrations/:id                  — get single job (progress polling)
//   POST   /api/v1/migrations/start-csv            — start Salesforce CSV / generic CSV import
//   POST   /api/v1/migrations/mappings             — save column mappings
//   GET    /api/v1/migrations/mappings             — get saved mappings (for wizard pre-fill)
//   DELETE /api/v1/migrations/:id/cancel           — cancel a running job
//   DELETE /api/v1/migrations/:id/undo             — undo a completed import (within 24h)
//   GET    /api/v1/migrations/:id/errors.csv       — download failed rows as CSV
//   GET    /api/v1/migrations/hubspot/auth         — initiate HubSpot OAuth flow
//   GET    /api/v1/migrations/hubspot/callback     — HubSpot OAuth callback
//   POST   /api/v1/migrations/start-hubspot        — start HubSpot import after OAuth

import { Queue } from 'bullmq';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '@bidstack/db';
import {
  MigrationJobResponse,
  MigrationMappingResponse,
  MigrationSourceEnum,
  MigrationStatusEnum,
  SaveMappingRequest,
  MigrationJobPayload,
  HUBSPOT_COMPANY_DEFAULTS,
  HUBSPOT_CONTACT_DEFAULTS,
  HUBSPOT_DEAL_DEFAULTS,
  DedupStrategyEnum,
  type MigrationJobError,
} from '@bidstack/shared';
import { MIGRATION } from '@bidstack/shared';
import { encryptSecret, decryptSecret } from '@bidstack/shared/server-crypto';
import {
  buildHubSpotAuthUrl,
  exchangeHubSpotCode,
  countHubSpotObject,
  type HubSpotTokens,
} from '../lib/hubspot-client.js';

// ─── Helper ──────────────────────────────────────────────────────────────────

function serializeJob(row: {
  id: string;
  orgId: string;
  userId: string;
  source: string;
  status: string;
  totalRows: number;
  processedRows: number;
  errorRows: number;
  startedAt: Date | null;
  completedAt: Date | null;
  errorSummary: unknown;
  meta: unknown;
  undoableUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): MigrationJobResponse {
  return {
    id: row.id,
    orgId: row.orgId,
    userId: row.userId,
    source: row.source as MigrationJobResponse['source'],
    status: row.status as MigrationJobResponse['status'],
    totalRows: row.totalRows,
    processedRows: row.processedRows,
    errorRows: row.errorRows,
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    errorSummary: (row.errorSummary as MigrationJobError[]) ?? [],
    meta: (row.meta as Record<string, unknown>) ?? {},
    undoableUntil: row.undoableUntil?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function serializeMapping(row: {
  id: string;
  orgId: string;
  source: string;
  sourceEntity: string;
  mappings: unknown;
  createdAt: Date;
  updatedAt: Date;
}): MigrationMappingResponse {
  return {
    id: row.id,
    orgId: row.orgId,
    source: row.source as MigrationMappingResponse['source'],
    sourceEntity: row.sourceEntity,
    mappings: (row.mappings as Record<string, string | null>) ?? {},
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ─── Route plugin ─────────────────────────────────────────────────────────────

export const migrationRoutes: FastifyPluginAsyncZod = async (server) => {
  // BullMQ queue handle (producer side only — worker consumes).
  // Lazily initialised so the test environment doesn't need Redis configured.
  let migrationQueue: Queue | null = null;
  const getQueue = () => {
    if (!migrationQueue) {
      const { redis } = server as unknown as { redis: { status: string; duplicate: () => unknown } };
      // Use the shared Redis connection already attached to the server via the
      // redis-cache plugin. This avoids opening a second connection.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      migrationQueue = new Queue(MIGRATION.name, {
        connection: (redis as unknown as { duplicate: () => unknown }).duplicate() as never,
        defaultJobOptions: MIGRATION.defaultJobOptions as never,
      });
    }
    return migrationQueue;
  };

  // ─── List jobs ─────────────────────────────────────────────────────────

  server.get(
    '/migrations',
    {
      schema: {
        querystring: z.object({
          status: MigrationStatusEnum.optional(),
          limit: z.coerce.number().int().min(1).max(100).default(20),
        }),
        response: { 200: z.object({ items: z.array(MigrationJobResponse) }) },
      },
    },
    async (req) => {
      const { orgId } = req.auth;
      const { status, limit } = req.query;

      const jobs = await prisma.migrationJob.findMany({
        where: { orgId, ...(status ? { status } : {}) },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });

      return { items: jobs.map(serializeJob) };
    },
  );

  // ─── Get single job ────────────────────────────────────────────────────

  server.get(
    '/migrations/:id',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: MigrationJobResponse },
      },
    },
    async (req) => {
      const { orgId } = req.auth;
      const job = await prisma.migrationJob.findFirst({
        where: { id: req.params.id, orgId },
      });
      if (!job) throw server.httpErrors.notFound('Migration job not found');
      return serializeJob(job);
    },
  );

  // ─── Start CSV migration ───────────────────────────────────────────────

  server.post(
    '/migrations/start-csv',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        body: z.object({
          source: z.enum(['SALESFORCE_CSV', 'CSV']),
          entityType: z.string().min(1),
          // CSV data as an array of records (parsed client-side before upload).
          // Each element is a row: { columnName: value }.
          // Why client-side: avoids streaming large CSV bodies through the API.
          // Production path: upload raw CSV to presigned URL, then call this
          // endpoint with a redisKey pointing to the stored data.
          rows: z.array(z.record(z.string())).min(1).max(10_000),
          mappings: z.record(z.string().nullable()),
          dedupStrategy: DedupStrategyEnum.default('update'),
          externalIdColumn: z.string().optional(),
        }),
        response: { 201: MigrationJobResponse },
      },
    },
    async (req, reply) => {
      const { orgId, userId } = req.auth;
      const { source, entityType, rows, mappings, dedupStrategy, externalIdColumn } = req.body;

      // File size guard — each row serialised is ~200 bytes average;
      // 10k rows * 200 bytes = 2 MB, well inside 50 MB limit.
      // The real enforcement is at upload-url time for raw file uploads.

      // Create the MigrationJob row first, then enqueue chunks.
      const job = await prisma.migrationJob.create({
        data: {
          orgId,
          userId,
          source,
          status: 'PENDING',
          totalRows: rows.length,
          meta: { entityType },
        },
      });

      // Write audit entry.
      await prisma.auditLog.create({
        data: {
          orgId,
          userId,
          action: 'migration.start',
          targetType: 'MigrationJob',
          targetId: job.id,
          diff: { source, entityType, totalRows: rows.length },
        },
      });

      // Persist column mappings for future retry (upsert by orgId+source+entity).
      await prisma.migrationMapping.upsert({
        where: { orgId_source_sourceEntity: { orgId, source, sourceEntity: entityType } },
        create: { orgId, source, sourceEntity: entityType, mappings },
        update: { mappings },
      });

      // Store rows in Redis under a TTL key so the worker can read them.
      // Key: migration:<jobId>:<entityType>:rows
      const redisKey = `migration:${job.id}:${entityType}:rows`;
      const redisConn = (server as unknown as { redis: { set: (k: string, v: string, ex: string, ttl: number) => Promise<void> } }).redis;
      await redisConn.set(redisKey, JSON.stringify(rows), 'EX', 3600); // 1h TTL

      // Enqueue one job per chunk of 100 rows.
      const CHUNK_SIZE = 100;
      const chunks = Math.ceil(rows.length / CHUNK_SIZE);
      const queue = getQueue();

      for (let i = 0; i < chunks; i++) {
        const payload: MigrationJobPayload = {
          migrationJobId: job.id,
          orgId,
          userId,
          source,
          entityType,
          chunkOffset: i * CHUNK_SIZE,
          chunkSize: CHUNK_SIZE,
          totalRows: rows.length,
          redisKey,
          mappings,
          dedupStrategy,
          externalIdColumn,
        };
        await queue.add(`${job.id}-chunk-${i}`, payload, {
          jobId: `${job.id}-${entityType}-chunk-${i}`,
        });
      }

      // Transition to RUNNING now that all chunks are queued.
      const updated = await prisma.migrationJob.update({
        where: { id: job.id },
        data: { status: 'RUNNING', startedAt: new Date() },
      });

      return reply.code(201).send(serializeJob(updated));
    },
  );

  // ─── Save mappings ─────────────────────────────────────────────────────

  server.post(
    '/migrations/mappings',
    {
      schema: {
        body: SaveMappingRequest,
        response: { 200: MigrationMappingResponse },
      },
    },
    async (req) => {
      const { orgId } = req.auth;
      const { source, sourceEntity, mappings } = req.body;

      const row = await prisma.migrationMapping.upsert({
        where: { orgId_source_sourceEntity: { orgId, source, sourceEntity } },
        create: { orgId, source, sourceEntity, mappings },
        update: { mappings },
      });

      return serializeMapping(row);
    },
  );

  // ─── Get mappings ──────────────────────────────────────────────────────

  server.get(
    '/migrations/mappings',
    {
      schema: {
        querystring: z.object({
          source: MigrationSourceEnum,
          sourceEntity: z.string().min(1).optional(),
        }),
        response: { 200: z.object({ items: z.array(MigrationMappingResponse) }) },
      },
    },
    async (req) => {
      const { orgId } = req.auth;
      const { source, sourceEntity } = req.query;

      const rows = await prisma.migrationMapping.findMany({
        where: { orgId, source, ...(sourceEntity ? { sourceEntity } : {}) },
        orderBy: { sourceEntity: 'asc' },
      });

      return { items: rows.map(serializeMapping) };
    },
  );

  // ─── Cancel job ────────────────────────────────────────────────────────

  server.delete(
    '/migrations/:id/cancel',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: MigrationJobResponse },
      },
    },
    async (req) => {
      const { orgId, userId } = req.auth;
      const job = await prisma.migrationJob.findFirst({
        where: { id: req.params.id, orgId },
      });
      if (!job) throw server.httpErrors.notFound('Migration job not found');
      if (job.status === 'COMPLETE' || job.status === 'CANCELLED' || job.status === 'FAILED') {
        throw server.httpErrors.conflict(`Cannot cancel a job with status ${job.status}`);
      }

      const updated = await prisma.migrationJob.update({
        where: { id: req.params.id },
        data: { status: 'CANCELLED', completedAt: new Date() },
      });

      await prisma.auditLog.create({
        data: {
          orgId,
          userId,
          action: 'migration.cancel',
          targetType: 'MigrationJob',
          targetId: job.id,
        },
      });

      return serializeJob(updated);
    },
  );

  // ─── Undo migration ────────────────────────────────────────────────────

  server.delete(
    '/migrations/:id/undo',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: z.object({ message: z.string(), deletedCount: z.number() }) },
      },
    },
    async (req) => {
      const { orgId, userId } = req.auth;
      const job = await prisma.migrationJob.findFirst({
        where: { id: req.params.id, orgId },
      });
      if (!job) throw server.httpErrors.notFound('Migration job not found');
      if (job.status !== 'COMPLETE') {
        throw server.httpErrors.conflict('Only completed jobs can be undone');
      }
      if (!job.undoableUntil || job.undoableUntil < new Date()) {
        throw server.httpErrors.gone('Undo window has expired (24h limit)');
      }

      // Delete records from tables that carry a source tag. Contacts and opportunities
      // do not currently expose a source column, so they are intentionally left alone.
      const sourceTag = `migration:${job.id}`;

      // Delete in order to respect FK constraints.
      const [companies, leads] = await Promise.all([
        prisma.company.deleteMany({ where: { orgId, source: sourceTag } }),
        prisma.lead.deleteMany({ where: { orgId, source: sourceTag } }),
      ]);

      const deletedCount = companies.count + leads.count;

      await prisma.migrationJob.update({
        where: { id: req.params.id },
        data: { status: 'FAILED', meta: { ...(job.meta as object), undone: true, undoneAt: new Date().toISOString() } },
      });

      await prisma.auditLog.create({
        data: {
          orgId,
          userId,
          action: 'migration.undo',
          targetType: 'MigrationJob',
          targetId: job.id,
          diff: { deletedCount, sourceTag },
        },
      });

      return { message: `Undo complete — deleted ${deletedCount} records`, deletedCount };
    },
  );

  // ─── Download failed rows as CSV ───────────────────────────────────────

  server.get(
    '/migrations/:id/errors.csv',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
      },
    },
    async (req, reply) => {
      const { orgId } = req.auth;
      const job = await prisma.migrationJob.findFirst({
        where: { id: req.params.id, orgId },
      });
      if (!job) throw server.httpErrors.notFound('Migration job not found');

      const errors = (job.errorSummary as MigrationJobError[]) ?? [];
      if (errors.length === 0) {
        return reply
          .header('Content-Type', 'text/csv; charset=utf-8')
          .send('row,field,message\n');
      }

      const header = 'row,field,message\n';
      const rows = errors
        .map((e) => `${e.row},${JSON.stringify(e.field ?? '')},${JSON.stringify(e.message)}`)
        .join('\n');

      return reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="migration-errors-${job.id}.csv"`)
        .send(header + rows);
    },
  );

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

      // Encode orgId + userId in state so callback can reconstruct auth context.
      // State is opaque to HubSpot; we verify it on callback.
      const { orgId, userId } = req.auth;
      const state = Buffer.from(JSON.stringify({ orgId, userId, ts: Date.now() })).toString(
        'base64url',
      );

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
        stateData = JSON.parse(Buffer.from(state, 'base64url').toString('utf8'));
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
        throw server.httpErrors.badRequest(
          'HubSpot not connected — complete OAuth flow first',
        );
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
        const discovery = (config.config as Record<string, unknown>).discovery as Record<string, number>;
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
          where: { orgId_source_sourceEntity: { orgId, source: 'HUBSPOT_OAUTH', sourceEntity: entity } },
          create: { orgId, source: 'HUBSPOT_OAUTH', sourceEntity: entity, mappings: entityMappings[entity] ?? {} },
          update: { mappings: entityMappings[entity] ?? {} },
        });

        // Enqueue first chunk — worker will paginate via hubspotAfter.
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
          // Store access token in payload. Worker refreshes if near expiry.
          // This is safe because BullMQ jobs are stored in Redis (not logs).
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any;
        // Attach token to meta — worker reads from payload.meta.accessToken.
        (payload as Record<string, unknown>).meta = { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresAt: tokens.expiresAt };

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

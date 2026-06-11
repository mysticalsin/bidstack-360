// Migration connector routes (core).
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
//
// HubSpot OAuth + import → migrations-hubspot.routes.ts

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
  type MigrationJobPayload,
  DedupStrategyEnum,
  type MigrationJobError,
  MIGRATION,
} from '@bidstack/shared';

import { serializeJob, serializeMapping } from './migrations.helpers.js';

export const migrationRoutes: FastifyPluginAsyncZod = async (server) => {
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
          // WHY client-side: avoids streaming large CSV bodies through the API.
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

      await prisma.migrationMapping.upsert({
        where: { orgId_source_sourceEntity: { orgId, source, sourceEntity: entityType } },
        create: { orgId, source, sourceEntity: entityType, mappings },
        update: { mappings },
      });

      // Store rows in Redis with 1h TTL so the worker can read them in chunks.
      const redisKey = `migration:${job.id}:${entityType}:rows`;
      const redisConn = (
        server as unknown as {
          redis: { set: (k: string, v: string, ex: string, ttl: number) => Promise<void> };
        }
      ).redis;
      await redisConn.set(redisKey, JSON.stringify(rows), 'EX', 3600);

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

      // Two undo mechanisms, both org-scoped:
      // 1. source tag — Company/Lead carry source='migration:<jobId>'.
      // 2. audit trail — the worker logs every created id per chunk
      //    ('migration.chunk.imported'), which is the only way to find
      //    imported Contacts/Opportunities (no source column on those models).
      const sourceTag = `migration:${job.id}`;
      // Bounded: one import fans out to many chunks, but the cap keeps the
      // query within the query-guard's unbounded-findMany limit. A 10k-row
      // import is 100 chunks at chunkSize 100, well under this.
      const chunkLogs = await prisma.auditLog.findMany({
        where: { orgId, action: 'migration.chunk.imported', targetId: job.id },
        select: { diff: true },
        take: 1000,
      });
      const idsByEntity: Record<string, string[]> = {};
      for (const log of chunkLogs) {
        const diff = log.diff as { entity?: string; createdIds?: string[] } | null;
        if (!diff?.entity || !Array.isArray(diff.createdIds)) continue;
        (idsByEntity[diff.entity] ??= []).push(...diff.createdIds);
      }

      const oppIds = idsByEntity['opportunity'] ?? [];
      const contactIds = idsByEntity['contact'] ?? [];
      const companyIds = idsByEntity['company'] ?? [];
      const leadIds = idsByEntity['lead'] ?? [];

      // Children first (FK order): opportunities/contacts reference companies.
      // Skip the delete entirely when there are no audit-tracked ids — Prisma
      // rejects an empty `{ in: [] }` as a validation error (-> 400).
      const [opportunities, contacts] = await Promise.all([
        oppIds.length
          ? prisma.opportunity.deleteMany({ where: { orgId, id: { in: oppIds } } })
          : Promise.resolve({ count: 0 }),
        contactIds.length
          ? prisma.contact.deleteMany({ where: { orgId, id: { in: contactIds } } })
          : Promise.resolve({ count: 0 }),
      ]);
      const [companies, leads] = await Promise.all([
        prisma.company.deleteMany({
          where: {
            orgId,
            ...(companyIds.length
              ? { OR: [{ source: sourceTag }, { id: { in: companyIds } }] }
              : { source: sourceTag }),
          },
        }),
        prisma.lead.deleteMany({
          where: {
            orgId,
            ...(leadIds.length
              ? { OR: [{ source: sourceTag }, { id: { in: leadIds } }] }
              : { source: sourceTag }),
          },
        }),
      ]);
      const deletedCount = companies.count + leads.count + contacts.count + opportunities.count;

      await prisma.migrationJob.update({
        where: { id: req.params.id },
        data: {
          status: 'FAILED',
          meta: { ...(job.meta as object), undone: true, undoneAt: new Date().toISOString() },
        },
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
    { schema: { params: z.object({ id: z.string().uuid() }) } },
    async (req, reply) => {
      const { orgId } = req.auth;
      const job = await prisma.migrationJob.findFirst({
        where: { id: req.params.id, orgId },
      });
      if (!job) throw server.httpErrors.notFound('Migration job not found');

      const errors = (job.errorSummary as MigrationJobError[]) ?? [];
      if (errors.length === 0) {
        return reply.header('Content-Type', 'text/csv; charset=utf-8').send('row,field,message\n');
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
};

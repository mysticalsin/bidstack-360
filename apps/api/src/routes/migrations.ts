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

import { randomUUID } from 'node:crypto';

import * as XLSX from '@e965/xlsx';
import { Queue } from 'bullmq';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma, type Prisma } from '@bidstack/db';
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
  migrationAttemptId,
  migrationFrom,
  migrationProgressAt,
  MIGRATION_ENQUEUE_FAILED,
  MIGRATION_ROWS_EXPIRED,
  migrationErrorsCsv,
  migrationRetryAllowed,
  migrationStaleDue,
} from '@bidstack/shared';

import { previewImportRows } from '../lib/import-preview.js';
import { enqueueHubspotChunk } from '../services/hubspot-import.js';
import { serializeJob, serializeMapping } from './migrations.helpers.js';

const ENQUEUE_FAILURE = MIGRATION_ENQUEUE_FAILED;
const CHUNK_SIZE = 100;

/** Empty on purpose. Retry takes the id from the path and no fields. */
const RetryBody = z.object({}).strict().nullish();

function stalledFlag(job: {
  status: string;
  meta: unknown;
  processedRows: number;
  errorRows: number;
}): boolean {
  const state = job.status as 'PENDING' | 'RUNNING' | 'COMPLETE' | 'FAILED' | 'CANCELLED';
  return migrationStaleDue({
    state,
    progressAt: migrationProgressAt(job.meta),
    processedRows: job.processedRows,
    errorRows: job.errorRows,
    now: new Date(),
  });
}

async function enqueueCsvChunks(input: {
  jobId: string;
  orgId: string;
  userId: string;
  source: MigrationJobPayload['source'];
  entityType: string;
  rows: Record<string, string>[];
  redisKey: string;
  mappings: Record<string, string | null>;
  dedupStrategy: 'skip' | 'update' | 'duplicate';
  externalIdColumn?: string;
  attemptId: string;
  queue: Queue;
  nameFor: (index: number) => string;
  idFor: (index: number) => string;
}): Promise<void> {
  const chunks = Math.ceil(input.rows.length / CHUNK_SIZE);
  for (let i = 0; i < chunks; i++) {
    const payload: MigrationJobPayload = {
      migrationJobId: input.jobId,
      orgId: input.orgId,
      userId: input.userId,
      source: input.source,
      entityType: input.entityType,
      chunkOffset: i * CHUNK_SIZE,
      chunkSize: CHUNK_SIZE,
      totalRows: input.rows.length,
      redisKey: input.redisKey,
      mappings: input.mappings,
      dedupStrategy: input.dedupStrategy,
      externalIdColumn: input.externalIdColumn,
      attemptId: input.attemptId,
    };
    await input.queue.add(input.nameFor(i), payload, { jobId: input.idFor(i) });
  }
}

async function markMigrationEnqueueFailed(
  id: string,
  orgId: string,
  log: { warn: (obj: object, msg?: string) => void },
  message = ENQUEUE_FAILURE,
): Promise<void> {
  const failed = await prisma.migrationJob.updateMany({
    where: { id, orgId, status: { in: [...migrationFrom('fail')] } },
    data: {
      status: 'FAILED',
      completedAt: new Date(),
      errorSummary: [{ row: 0, field: null, message }],
    },
  });
  if (failed.count !== 1) {
    const current = await prisma.migrationJob.findFirst({
      where: { id, orgId },
      select: { status: true },
    });
    log.warn(
      { migrationJobId: id, from: current?.status ?? null, to: 'FAILED' },
      'illegal migration transition',
    );
  }
}

const ImportPreviewResponse = z.object({
  entityType: z.string(),
  rowCount: z.number().int(),
  validCount: z.number().int(),
  invalidCount: z.number().int(),
  issues: z.array(
    z.object({
      row: z.number().int(),
      field: z.string().nullable(),
      message: z.string(),
    }),
  ),
  sample: z.array(z.record(z.string())),
});

const ParsedSpreadsheetResponse = z.object({
  headers: z.array(z.string()),
  rows: z.array(z.record(z.string())),
});

export const migrationRoutes: FastifyPluginAsyncZod = async (server) => {
  // RBAC: CSV import / mapping / cancel / undo mutate tenant data in bulk —
  // require settings:write (admin-grade), matching tenant-export/erasure.
  server.addHook('preHandler', async (req) => {
    if (req.method !== 'GET') await server.requirePermission('settings:write')(req);
  });

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
      config: { permission: 'migrations:read' },
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
      return { items: jobs.map((job) => ({ ...serializeJob(job), stalled: stalledFlag(job) })) };
    },
  );

  // ─── Get single job ────────────────────────────────────────────────────

  server.get(
    '/migrations/:id',
    {
      config: { permission: 'migrations:read' },
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
      // Read-only. The worker persists RUNNING → FAILED. This flag is derived
      // so a poll can show the stall before that write lands.
      return { ...serializeJob(job), stalled: stalledFlag(job) };
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
          meta: { entityType, dedupStrategy, externalIdColumn: externalIdColumn ?? null },
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

      // Claim RUNNING before any chunk exists. A by-id write after enqueue
      // overwrites a cancel that landed while the chunks were being queued,
      // and a chunk that dies while the row is still PENDING is invisible to
      // the exhausted-retry handler (it only fails a RUNNING job).
      const attemptId = randomUUID();
      const claimed = await prisma.migrationJob.updateMany({
        where: { id: job.id, orgId, status: { in: [...migrationFrom('start')] } },
        data: {
          status: 'RUNNING',
          startedAt: new Date(),
          meta: { entityType, dedupStrategy, externalIdColumn: externalIdColumn ?? null, attemptId },
        },
      });
      if (claimed.count !== 1) {
        const current = await prisma.migrationJob.findFirst({
          where: { id: job.id, orgId },
          select: { status: true },
        });
        req.log.warn(
          { migrationJobId: job.id, from: current?.status ?? null, to: 'RUNNING' },
          'illegal migration transition',
        );
        throw server.httpErrors.conflict('Migration job is no longer pending');
      }

      const queue = getQueue();

      try {
        await enqueueCsvChunks({
          jobId: job.id,
          orgId,
          userId,
          source,
          entityType,
          rows,
          redisKey,
          mappings,
          dedupStrategy,
          externalIdColumn,
          attemptId,
          queue,
          nameFor: (i) => `${job.id}-chunk-${i}`,
          idFor: (i) => `${job.id}-${entityType}-chunk-${i}`,
        });
      } catch (err) {
        // The claim already moved the row to RUNNING. Leave it FAILED so the
        // wizard can show the failure and offer retry. A cancel that won the
        // race is left alone.
        req.log.error({ err, migrationJobId: job.id }, 'failed to enqueue import chunks');
        await markMigrationEnqueueFailed(job.id, orgId, req.log);
        const failedJob = await prisma.migrationJob.findFirstOrThrow({
          where: { id: job.id, orgId },
        });
        return reply.code(201).send(serializeJob(failedJob));
      }

      const updated = await prisma.migrationJob.findFirstOrThrow({
        where: { id: job.id, orgId },
      });
      return reply.code(201).send(serializeJob(updated));
    },
  );

  server.post(
    '/migrations/:id/retry',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: RetryBody,
        response: { 200: MigrationJobResponse },
      },
    },
    async (req) => {
      const { orgId, userId } = req.auth;
      const job = await prisma.migrationJob.findFirst({
        where: { id: req.params.id, orgId },
      });
      if (!job) throw server.httpErrors.notFound('Migration job not found');
      const meta = (job.meta ?? {}) as {
        entityType?: string;
        dedupStrategy?: 'skip' | 'update' | 'duplicate';
        externalIdColumn?: string | null;
      };
      if (
        job.status !== 'FAILED' ||
        !migrationRetryAllowed(job.processedRows, job.errorRows) ||
        !meta.entityType
      ) {
        throw server.httpErrors.conflict('This import cannot be retried. Start it again from the file.');
      }

      const attemptId = randomUUID();
      const previousAttempt = migrationAttemptId(job.meta);
      // Clear the previous claim clock in this same compare-and-set. A second
      // write would leave the old progressAt in place for the stale scan.
      const fresh = { ...(job.meta as object) } as Record<string, unknown>;
      delete fresh.progressAt;
      fresh.attemptId = attemptId;
      const claimed = await prisma.$transaction(async (tx) => {
        const moved = await tx.migrationJob.updateMany({
          where: { id: job.id, orgId, status: { in: [...migrationFrom('retry')] } },
          data: {
            status: 'RUNNING',
            startedAt: new Date(),
            completedAt: null,
            errorSummary: [],
            meta: fresh as Prisma.InputJsonValue,
          },
        });
        if (moved.count !== 1) return 0;
        await tx.auditLog.create({
          data: {
            orgId,
            userId,
            action: 'migration.retry',
            targetType: 'MigrationJob',
            targetId: job.id,
            diff: { previousAttempt, attemptId },
          },
        });
        return moved.count;
      });
      if (claimed !== 1) {
        const current = await prisma.migrationJob.findFirst({
          where: { id: job.id, orgId },
          select: { status: true },
        });
        req.log.warn(
          { migrationJobId: job.id, from: current?.status ?? null, to: 'RUNNING' },
          'illegal migration transition',
        );
        throw server.httpErrors.conflict('Migration job is no longer failed');
      }

      const queue = getQueue();
      try {
        if (job.source === 'HUBSPOT_OAUTH') {
          await enqueueHubspotChunk({
            jobId: job.id,
            orgId,
            userId,
            entityType: meta.entityType,
            totalRows: job.totalRows,
            dedupStrategy: meta.dedupStrategy ?? 'update',
            attemptId,
            queue,
          });
        } else {
          const redisKey = `migration:${job.id}:${meta.entityType}:rows`;
          const redisConn = (
            server as unknown as { redis: { get: (key: string) => Promise<string | null> } }
          ).redis;
          const raw = await redisConn.get(redisKey);
          if (!raw) throw new Error(MIGRATION_ROWS_EXPIRED);
          const rows = JSON.parse(raw) as Record<string, string>[];
          const mapping = await prisma.migrationMapping.findUnique({
            where: {
              orgId_source_sourceEntity: {
                orgId,
                source: job.source,
                sourceEntity: meta.entityType,
              },
            },
          });
          const mappings = (mapping?.mappings ?? {}) as Record<string, string | null>;
          const stamp = Date.now();
          await enqueueCsvChunks({
            jobId: job.id,
            orgId,
            userId,
            source: job.source,
            entityType: meta.entityType,
            rows,
            redisKey,
            mappings,
            dedupStrategy: meta.dedupStrategy ?? 'update',
            externalIdColumn: meta.externalIdColumn ?? undefined,
            attemptId,
            queue,
            nameFor: (i) => `${job.id}-retry-${i}`,
            idFor: (i) => `${job.id}-${meta.entityType}-retry-${stamp}-${i}`,
          });
        }
      } catch (err) {
        const message =
          err instanceof Error && err.message === MIGRATION_ROWS_EXPIRED
            ? MIGRATION_ROWS_EXPIRED
            : ENQUEUE_FAILURE;
        req.log.error({ err, migrationJobId: job.id }, 'failed to retry import');
        await markMigrationEnqueueFailed(job.id, orgId, req.log, message);
      }

      const updated = await prisma.migrationJob.findFirstOrThrow({
        where: { id: job.id, orgId },
      });
      return serializeJob(updated);
    },
  );

  server.post(
    '/migrations/preview-csv',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        body: z.object({
          entityType: z.string().min(1),
          rows: z.array(z.record(z.string())).min(1).max(10_000),
          mappings: z.record(z.string().nullable()),
        }),
        response: { 200: ImportPreviewResponse },
      },
    },
    async (req) => {
      return previewImportRows(req.body);
    },
  );

  server.post(
    '/migrations/parse-spreadsheet',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        body: z.object({
          filename: z.string().min(1).max(255),
          contentBase64: z.string().min(1).max(15_000_000),
        }),
        response: { 200: ParsedSpreadsheetResponse },
      },
    },
    async (req) => {
      const name = req.body.filename.toLowerCase();
      if (!name.endsWith('.xlsx') && !name.endsWith('.xls') && !name.endsWith('.csv')) {
        throw server.httpErrors.badRequest('Only CSV and Excel (.xlsx) files are accepted');
      }
      const buf = Buffer.from(req.body.contentBase64, 'base64');
      if (buf.length > 8 * 1024 * 1024) {
        throw server.httpErrors.payloadTooLarge('Spreadsheet must be 8 MB or smaller');
      }
      return parseSpreadsheetBuffer(buf, name);
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
      config: { permission: 'migrations:read' },
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
      // The read above can be stale. Only PENDING or RUNNING may become CANCELLED.
      const moved = await prisma.migrationJob.updateMany({
        where: { id: job.id, orgId, status: { in: [...migrationFrom('cancel')] } },
        data: { status: 'CANCELLED', completedAt: new Date() },
      });
      if (moved.count !== 1) {
        const current = await prisma.migrationJob.findFirst({
          where: { id: job.id, orgId },
          select: { status: true },
        });
        req.log.warn(
          { migrationJobId: job.id, from: current?.status ?? null, to: 'CANCELLED' },
          'illegal migration transition',
        );
        throw server.httpErrors.conflict(
          `Cannot cancel a job with status ${current?.status ?? job.status}`,
        );
      }
      const updated = await prisma.migrationJob.findFirstOrThrow({
        where: { id: job.id, orgId },
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
      const financialIds = idsByEntity['financial'] ?? [];

      // Children first (FK order): opportunities/contacts reference companies.
      // Skip the delete entirely when there are no audit-tracked ids — Prisma
      // rejects an empty `{ in: [] }` as a validation error (-> 400).
      // WHY one interactive transaction: undo is a destructive bulk operation.
      // Without atomicity, a failure after the first deletes commit leaves a
      // half-undone import — opportunities/contacts gone, companies/leads kept,
      // job still reading COMPLETE — with no rollback and no clean retry.
      // Deletes run sequentially (not Promise.all) — interactive transactions
      // hold a single connection, and the order preserves FK safety.
      const deletedCount = await prisma.$transaction(async (tx) => {
        // Claim the undo before deleting anything. A stale COMPLETE read must
        // not wipe rows when the job is no longer COMPLETE.
        const moved = await tx.migrationJob.updateMany({
          where: {
            id: job.id,
            orgId,
            status: { in: [...migrationFrom('undo')] },
            undoableUntil: { gt: new Date() },
          },
          data: {
            status: 'FAILED',
            meta: { ...(job.meta as object), undone: true, undoneAt: new Date().toISOString() },
          },
        });
        if (moved.count !== 1) {
          const current = await tx.migrationJob.findUnique({
            where: { id: job.id },
            select: { status: true },
          });
          req.log.warn(
            { migrationJobId: job.id, from: current?.status ?? null, to: 'FAILED' },
            'illegal migration transition',
          );
          throw server.httpErrors.conflict('Only completed jobs can be undone');
        }

        const opportunities = oppIds.length
          ? await tx.opportunity.deleteMany({ where: { orgId, id: { in: oppIds } } })
          : { count: 0 };
        const contacts = contactIds.length
          ? await tx.contact.deleteMany({ where: { orgId, id: { in: contactIds } } })
          : { count: 0 };
        const companies = await tx.company.deleteMany({
          where: {
            orgId,
            ...(companyIds.length
              ? { OR: [{ source: sourceTag }, { id: { in: companyIds } }] }
              : { source: sourceTag }),
          },
        });
        const leads = await tx.lead.deleteMany({
          where: {
            orgId,
            ...(leadIds.length
              ? { OR: [{ source: sourceTag }, { id: { in: leadIds } }] }
              : { source: sourceTag }),
          },
        });
        const financials = financialIds.length
          ? await tx.accountFinancialPeriod.deleteMany({
              where: { orgId, id: { in: financialIds } },
            })
          : { count: 0 };
        const deleted =
          companies.count + leads.count + contacts.count + opportunities.count + financials.count;

        await tx.auditLog.create({
          data: {
            orgId,
            userId,
            action: 'migration.undo',
            targetType: 'MigrationJob',
            targetId: job.id,
            diff: { deletedCount: deleted, sourceTag },
          },
        });
        return deleted;
      });
      return { message: `Undo complete — deleted ${deletedCount} records`, deletedCount };
    },
  );

  // ─── Download failed rows as CSV ───────────────────────────────────────

  server.get(
    '/migrations/:id/errors.csv',
    { config: { permission: 'migrations:read' }, schema: { params: z.object({ id: z.string().uuid() }) } },
    async (req, reply) => {
      const { orgId } = req.auth;
      const job = await prisma.migrationJob.findFirst({
        where: { id: req.params.id, orgId },
      });
      if (!job) throw server.httpErrors.notFound('Migration job not found');

      const errors = (job.errorSummary as MigrationJobError[]) ?? [];
      return reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="migration-errors-${job.id}.csv"`)
        .send(migrationErrorsCsv(errors));
    },
  );
};

function parseSpreadsheetBuffer(
  buf: Buffer,
  filename: string,
): { headers: string[]; rows: Record<string, string>[] } {
  if (filename.endsWith('.csv')) {
    const text = buf.toString('utf8');
    const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
    const headers = (lines[0] ?? '').split(',').map((h) => h.trim());
    const rows = lines.slice(1).map((line) => {
      const cells = line.split(',');
      const row: Record<string, string> = {};
      headers.forEach((header, i) => {
        row[header] = (cells[i] ?? '').trim();
      });
      return row;
    });
    return { headers, rows: rows.slice(0, 10_000) };
  }

  const workbook = XLSX.read(buf, { type: 'buffer', cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
  if (!sheet) return { headers: [], rows: [] };
  const records = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: '',
    raw: false,
  });
  const headers = records[0] ? Object.keys(records[0]) : [];
  const rows = records.slice(0, 10_000).map((record) => {
    const row: Record<string, string> = {};
    for (const header of headers) {
      row[header] = String(record[header] ?? '').trim();
    }
    return row;
  });
  return { headers, rows };
}

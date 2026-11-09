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

import * as XLSX from '@e965/xlsx';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
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

import { previewImportRows } from '../lib/import-preview.js';
import { serializeJob, serializeMapping } from './migrations.helpers.js';
import { addWithinDeadline, QUEUE_ENQUEUE_TIMEOUT_MS, QueueUnavailableError } from '../lib/queue-enqueue.js';
import { redis } from '../redis.js';

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
      const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6380', {
        maxRetriesPerRequest: null,
        enableOfflineQueue: true,
        lazyConnect: false,
      });
      connection.on('error', (err) => {
        server.log.error({ err }, 'Redis connection error in migration queue');
      });
      migrationQueue = new Queue(MIGRATION.name, {
        connection,
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
      return { items: jobs.map(serializeJob) };
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

      // Store rows in Redis with 1h TTL so the worker can read them in chunks.
      const redisKey = `migration:${job.id}:${entityType}:rows`;
      const CHUNK_SIZE = 100;
      const chunks = Math.ceil(rows.length / CHUNK_SIZE);

      // The job row exists first because its id keys the rows and the chunks.
      // If either Redis step fails, the job row and the rows key are removed so
      // a failed start (and the client's retry) leaves nothing behind. The
      // audit log is append-only, so it is written only once the import is
      // queued. addBulk is one MULTI, so chunks land all together or not at all;
      // a chunk that lands after a timeout finds no job row and the worker skips it.
      try {
        try {
          await redis.set(redisKey, JSON.stringify(rows), 'EX', 3600);
        } catch (err) {
          const reason = err instanceof Error && /timed out/i.test(err.message) ? 'timed-out' : 'not-ready';
          throw new QueueUnavailableError(MIGRATION.name, reason, QUEUE_ENQUEUE_TIMEOUT_MS);
        }
        const chunkJobs = Array.from({ length: chunks }, (_, i) => {
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
          return {
            name: `${job.id}-chunk-${i}`,
            data: payload,
            opts: { jobId: `${job.id}-${entityType}-chunk-${i}` },
          };
        });
        await addWithinDeadline(getQueue(), (q) => q.addBulk(chunkJobs));
      } catch (err) {
        await prisma.migrationJob.delete({ where: { id: job.id } });
        await redis.del(redisKey).catch((delErr: unknown) => {
          req.log.warn({ err: delErr, redisKey }, 'could not remove rows of a failed migration start');
        });
        throw err;
      }

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

      const updated = await prisma.migrationJob.update({
        where: { id: job.id },
        data: { status: 'RUNNING', startedAt: new Date() },
      });
      return reply.code(201).send(serializeJob(updated));
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

        await tx.migrationJob.update({
          where: { id: req.params.id },
          data: {
            status: 'FAILED',
            meta: { ...(job.meta as object), undone: true, undoneAt: new Date().toISOString() },
          },
        });
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

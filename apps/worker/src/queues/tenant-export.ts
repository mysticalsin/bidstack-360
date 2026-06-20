// tenant-export worker — GDPR Article 20 (data portability).
//
// Produces a single gzipped NDJSON archive of every org-scoped business /
// personal-data entity and uploads it to durable storage, then drives the
// TenantExport row to `ready` with the storage key, size, and a 24h expiry.
//
// Design notes:
//  - CURSOR-BATCHED per entity (keyset on the UUID `id`), never a full-table
//    load — safe at 100k+ rows per entity.
//  - SECRET-SAFE by construction: each entity is exported through an explicit
//    positive `select` built from the Prisma DMMF with a field-name denylist
//    (hashes, tokens, encrypted blobs, signing secrets). Secret-bearing models
//    (ApiKey, IntegrationToken, webhook secrets, …) are simply NOT in the
//    registry — an allowlist, not a denylist, at the model level.
//  - IDEMPOTENT on redelivery: the job claims the row (pending|running ->
//    running) and bails if another attempt already finished it.

import { createGzip } from 'node:zlib';
import { PassThrough, type Readable } from 'node:stream';

import type { Queue, Worker, Job } from 'bullmq';
import type IORedis from 'ioredis';
import type pino from 'pino';

import { Worker as BullWorker } from 'bullmq';
import { prisma } from '@bidstack/db';
import { TENANT_EXPORT, TenantExportJob } from '@bidstack/shared';

import { uploadExportArchive } from '../lib/tenant-export-storage.js';
import {
  TENANT_EXPORT_ENTITIES,
  safeSelectForModel,
  type TenantExportEntity,
} from '../lib/tenant-export-registry.js';

const QUEUE_NAME = TENANT_EXPORT.name;

/** Rows fetched per keyset page. Bounds peak memory regardless of table size. */
const PAGE_SIZE = 500;
/** Signed download URL + storage object lifetime. */
const EXPIRY_HOURS = 24;

// ─── Prisma delegate access ──────────────────────────────────────────────────

// The Prisma delegates share a structural shape we rely on (findMany). Typing
// it explicitly keeps the registry loop free of `any` while still letting us
// index `prisma` by the model accessor name.
interface FindManyDelegate {
  findMany(args: {
    where: Record<string, unknown>;
    select: Record<string, true>;
    orderBy: { id: 'asc' };
    take: number;
    cursor?: { id: string };
    skip?: number;
  }): Promise<Array<Record<string, unknown>>>;
}

function delegateFor(accessor: string): FindManyDelegate {
  const delegate = (prisma as unknown as Record<string, FindManyDelegate>)[accessor];
  if (!delegate || typeof delegate.findMany !== 'function') {
    throw new Error(`tenant-export: no Prisma delegate for "${accessor}"`);
  }
  return delegate;
}

// ─── NDJSON archive streaming ────────────────────────────────────────────────

/**
 * BigInt/Date safe JSON. Prisma returns BigInt for `@db.BigInt` columns and
 * Date for timestamps; JSON.stringify throws on BigInt and would otherwise
 * emit non-portable Date objects, so normalize both at the edge.
 */
function jsonReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  return value;
}

function ndjsonLine(record: Record<string, unknown>): string {
  return `${JSON.stringify(record, jsonReplacer)}\n`;
}

/**
 * Stream one org-scoped entity into `sink` as NDJSON, keyset-paginated on the
 * UUID `id`. Returns the row count. Backpressure is honoured by awaiting the
 * stream `drain` event so a slow upload cannot let pages pile up in memory.
 */
async function streamEntity(
  orgId: string,
  entity: TenantExportEntity,
  sink: PassThrough,
  log: pino.Logger,
): Promise<number> {
  const delegate = delegateFor(entity.accessor);
  const select = safeSelectForModel(entity.model);
  // `org` has no orgId column — it IS the tenant; scope it by primary key.
  const where: Record<string, unknown> =
    entity.accessor === 'org' ? { id: orgId } : { orgId };

  let cursor: string | undefined;
  let total = 0;

  for (;;) {
    const page = await delegate.findMany({
      where,
      select,
      orderBy: { id: 'asc' },
      take: PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (page.length === 0) break;

    for (const row of page) {
      const line = ndjsonLine({ _entity: entity.name, ...row });
      if (!sink.write(line)) {
        await new Promise<void>((resolve) => sink.once('drain', resolve));
      }
    }
    total += page.length;
    cursor = page[page.length - 1]?.id as string | undefined;
    if (!cursor || page.length < PAGE_SIZE) break;
  }

  log.info({ entity: entity.name, rows: total }, 'tenant-export: entity streamed');
  return total;
}

/**
 * Build the full gzipped NDJSON archive as a readable stream and the promise
 * that resolves with per-entity counts once every entity has been written.
 * The producer runs detached so the uploader can consume the gzip output
 * concurrently (true streaming — the archive is never fully buffered).
 */
function buildArchiveStream(
  orgId: string,
  exportId: string,
  log: pino.Logger,
): { body: Readable; done: Promise<Record<string, number>> } {
  const ndjson = new PassThrough();
  const gzip = createGzip();
  ndjson.pipe(gzip);

  const done = (async () => {
    const counts: Record<string, number> = {};
    try {
      // Manifest line first so a consumer can identify the archive shape.
      ndjson.write(
        ndjsonLine({
          _entity: '_manifest',
          exportId,
          orgId,
          format: 'ndjson.gz',
          spec: 'gdpr-article-20',
          generatedAt: new Date().toISOString(),
          entities: TENANT_EXPORT_ENTITIES.map((e) => e.name),
        }),
      );
      for (const entity of TENANT_EXPORT_ENTITIES) {
        counts[entity.name] = await streamEntity(orgId, entity, ndjson, log);
      }
      ndjson.end();
    } catch (err) {
      ndjson.destroy(err as Error);
      throw err;
    }
    return counts;
  })();

  return { body: gzip, done };
}

// ─── Job handler ─────────────────────────────────────────────────────────────

/**
 * Process a tenant-export job. Exported for the contract test. Idempotent:
 * claims the row, and a redelivery after completion is a no-op.
 */
export async function processTenantExportJob(
  job: Pick<Job<unknown>, 'data'>,
  log: pino.Logger,
): Promise<void> {
  const parsed = TenantExportJob.safeParse(job.data);
  if (!parsed.success) {
    throw new Error(`tenant-export: invalid job data: ${parsed.error.message}`);
  }
  const { exportId, orgId } = parsed.data;

  // Claim: only a pending|running row for this org transitions to running.
  // `count === 0` means another attempt already finished/failed it, or it was
  // deleted — nothing to do (idempotent on redelivery).
  const claimed = await prisma.tenantExport.updateMany({
    where: { id: exportId, orgId, status: { in: ['pending', 'running'] }, deletedAt: null },
    data: { status: 'running', startedAt: new Date() },
  });
  if (claimed.count === 0) {
    log.info({ exportId, orgId }, 'tenant-export: skipped (already terminal or missing)');
    return;
  }

  try {
    const { body, done } = buildArchiveStream(orgId, exportId, log);
    const storageKey = exportStorageKey(orgId, exportId);
    // Upload consumes the gzip stream; `done` resolves when production finishes.
    const [{ bytes }, counts] = await Promise.all([
      uploadExportArchive({ key: storageKey, body }),
      done,
    ]);

    // Store the key + object-lifecycle expiry only. The download URL is signed
    // FRESH on each GET (recording-storage pattern) so a stale 24h URL is never
    // handed out; downloadUrl stays null in the row.
    const expiresAt = new Date(Date.now() + EXPIRY_HOURS * 3_600_000);

    await prisma.tenantExport.updateMany({
      where: { id: exportId, orgId, status: 'running' },
      data: {
        status: 'ready',
        storageKey,
        sizeBytes: BigInt(bytes),
        expiresAt,
        completedAt: new Date(),
        error: null,
      },
    });
    log.info(
      { exportId, orgId, bytes, entities: Object.keys(counts).length },
      'tenant-export: ready',
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'tenant export failed';
    await prisma.tenantExport.updateMany({
      where: { id: exportId, orgId, status: 'running' },
      data: { status: 'failed', error: message.slice(0, 2000), completedAt: new Date() },
    });
    throw err;
  }
}

/** Org-namespaced, export-scoped storage key. Mirrors the storage adapter's
 *  `orgs/<org>/…` partitioning so cross-tenant access is impossible. */
function exportStorageKey(orgId: string, exportId: string): string {
  return `orgs/${orgId}/exports/${exportId}.ndjson.gz`;
}

export async function startTenantExport(
  connection: IORedis,
  log: pino.Logger,
  workers: Worker[],
  _queues: Queue[],
): Promise<void> {
  const worker = new BullWorker(
    QUEUE_NAME,
    async (job) => processTenantExportJob(job, log.child({ jobId: job.id })),
    { connection, concurrency: 2 },
  );
  worker.on('completed', (job) => log.info({ jobId: job.id }, 'tenant-export: completed'));
  worker.on('failed', (job, err) => log.error({ jobId: job?.id, err }, 'tenant-export: failed'));
  workers.push(worker);
  log.info({ queue: QUEUE_NAME }, 'tenant-export worker started');
}

// Re-export so callers/tests can reach the helper through one module.
export { exportStorageKey };

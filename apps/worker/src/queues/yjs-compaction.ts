// Y.js CRDT compaction queue.
//
// WHY a scheduled BullMQ job rather than only inline compaction:
//   The persistence service does inline compaction at 100 updates per doc
//   to bound table growth during active editing. This job is the belt-and-
//   suspenders layer that catches docs missed during API downtime and prunes
//   the 30-day update log.
//
// Schedule: every 6 hours (configurable via YJS_COMPACT_CRON env var).
// Concurrency: 1 — compaction is idempotent but concurrent passes create
//   write contention and waste work.
//
// WHY merge logic is in this file rather than imported from the API service:
//   The worker and API are separate Node processes; the worker does not import
//   from apps/api/src. The merge algorithm is small enough to keep here without
//   violating the 400-line limit.

import * as Y from 'yjs';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Queue, Worker } from 'bullmq';
import type IORedis from 'ioredis';
import type pino from 'pino';
import { prisma } from '@bidstack/db';

// ─── Queue config ──────────────────────────────────────────────────────────

export const YJS_COMPACT_QUEUE = 'yjs.compact';

// Default: every 6 hours. Override via YJS_COMPACT_CRON.
const COMPACT_CRON = process.env.YJS_COMPACT_CRON ?? '0 */6 * * *';

// Prune updates older than this many days after merging.
const PRUNE_DAYS = parseInt(process.env.YJS_PRUNE_DAYS ?? '30', 10);

// ─── Encryption (mirrors yjs-persistence.service.ts) ──────────────────────
// WHY: must match the API service layer encryption so we can read/write the
// same binary columns. AES-256-GCM with a prepended 12-byte IV + 16-byte tag.

const ENCRYPTION_ENABLED = process.env.PII_FIELD_ENCRYPTION === 'true';
const ENC_KEY_HEX = (process.env.APP_SECRET ?? '0'.repeat(64)).slice(0, 64);
const ENC_KEY = Buffer.from(ENC_KEY_HEX, 'hex');

function encrypt(plainBuf: Buffer): Buffer {
  if (!ENCRYPTION_ENABLED) return plainBuf;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', ENC_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plainBuf), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]);
}

function decrypt(cipherBuf: Buffer): Buffer {
  if (!ENCRYPTION_ENABLED) return cipherBuf;
  const iv = cipherBuf.subarray(0, 12);
  const authTag = cipherBuf.subarray(12, 28);
  const ciphertext = cipherBuf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', ENC_KEY, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

// ─── Compaction logic ──────────────────────────────────────────────────────

interface CompactionResult {
  docsProcessed: number;
  updatesCompacted: number;
  updatesPruned: number;
}

async function runCompactionPass(log: pino.Logger): Promise<CompactionResult> {
  const result: CompactionResult = {
    docsProcessed: 0,
    updatesCompacted: 0,
    updatesPruned: 0,
  };

  // Raw query avoids loading full rows just to get distinct ydoc IDs.
  const docsWithUpdates = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT DISTINCT ydoc_id AS id FROM yjs_updates
  `;

  for (const { id: ydocId } of docsWithUpdates) {
    try {
      const compacted = await compactSingleDoc(ydocId);
      result.docsProcessed++;
      result.updatesCompacted += compacted;
    } catch (err: unknown) {
      log.error({ ydocId, err }, 'compaction failed for doc, skipping');
    }
  }

  // Prune old update rows across all docs.
  const cutoff = new Date(Date.now() - PRUNE_DAYS * 24 * 60 * 60 * 1_000);
  const pruned = await prisma.yjsUpdate.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  result.updatesPruned = pruned.count;

  return result;
}

async function compactSingleDoc(ydocId: string): Promise<number> {
  const existing = await prisma.yjsDocument.findUnique({
    where: { id: ydocId },
    include: { updates: { orderBy: { createdAt: 'asc' } } },
  });

  if (!existing || existing.updates.length === 0) return 0;

  const doc = new Y.Doc();
  const snapshotBytes = decrypt(Buffer.from(existing.ydocBinary));
  Y.applyUpdate(doc, new Uint8Array(snapshotBytes));

  for (const row of existing.updates) {
    const updateBytes = decrypt(Buffer.from(row.update));
    Y.applyUpdate(doc, new Uint8Array(updateBytes));
  }

  const mergedUpdate = Y.encodeStateAsUpdate(doc);
  const updateIds = existing.updates.map((u) => u.id);

  await prisma.$transaction([
    prisma.yjsDocument.update({
      where: { id: ydocId },
      data: { ydocBinary: encrypt(Buffer.from(mergedUpdate)) },
    }),
    // Delete only the rows we loaded — avoids racing with live edits.
    prisma.yjsUpdate.deleteMany({
      where: { id: { in: updateIds } },
    }),
  ]);

  return updateIds.length;
}

// ─── Exported starter ─────────────────────────────────────────────────────

export async function startYjsCompaction(
  connection: IORedis,
  log: pino.Logger,
  workers: Worker[],
  queues: Queue[],
): Promise<{ compactQueue: Queue }> {
  const compactQueue = new Queue(YJS_COMPACT_QUEUE, {
    connection,
    defaultJobOptions: {
      removeOnComplete: { age: 86_400, count: 24 },
      removeOnFail: { age: 86_400 * 7, count: 50 },
    },
  });

  queues.push(compactQueue);

  await compactQueue.add(
    'yjs.compact',
    {},
    {
      repeat: { pattern: COMPACT_CRON },
      // Stable job ID prevents duplicate scheduled jobs on process restart.
      jobId: 'yjs-compact-scheduled',
      removeOnComplete: { age: 86_400, count: 24 },
      removeOnFail: { age: 86_400 * 7 },
    },
  );

  const compactWorker = new Worker(
    YJS_COMPACT_QUEUE,
    async (job) => {
      const childLog = log.child({ jobId: job.id, jobName: job.name });
      childLog.info('yjs compaction job started');
      const result = await runCompactionPass(childLog);
      childLog.info(result, 'yjs compaction job complete');
      return result;
    },
    {
      connection,
      concurrency: 1,
      limiter: { max: 1, duration: 1_000 },
    },
  );

  compactWorker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'yjs.compact job failed');
  });

  workers.push(compactWorker);

  return { compactQueue };
}

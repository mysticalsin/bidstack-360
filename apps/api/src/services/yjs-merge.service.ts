// Y.js merge (compaction) service — batch operations for the background worker.
//
// WHY a separate service from yjs-persistence.service:
//   The persistence service handles hot-path per-connection operations.
//   This service handles cold-path batch compaction and pruning that runs
//   on a 6-hour cron in the BullMQ worker. Separation keeps both files
//   well under the 400-line limit and makes the dependency graph clear.
//
// Compaction strategy:
//   1. Find all YjsDocument rows that have ≥ 1 pending update.
//   2. For each, merge updates into the snapshot and delete merged rows.
//   3. Delete YjsUpdate rows older than PRUNE_DAYS (default 30).
//
// Concurrency: the worker runs a single `yjs.compact` job at a time
// (concurrency=1 in the queue config) so we do not need a distributed lock.

import * as Y from 'yjs';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { prisma } from '@bidstack/db';
import { pino } from 'pino';

const logger = pino({ name: 'yjs-merge.service' });

const PRUNE_DAYS = parseInt(process.env.YJS_PRUNE_DAYS ?? '30', 10);

// ─── Encryption — duplicated from persistence service to keep zero cross-dep ──
// WHY duplicated: yjs-merge runs in the worker process which does not import
// the API service tree. Shared logic lives in a platform package in production;
// here we keep it in-file to avoid a new package for one utility.

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

// ─── Batch compaction ──────────────────────────────────────────────────────

export interface CompactionResult {
  docsProcessed: number;
  updatesCompacted: number;
  updatesPruned: number;
}

/**
 * Run a full compaction pass over all orgs.
 * Called by the `yjs.compact` BullMQ job every 6 hours.
 */
export async function runCompactionPass(): Promise<CompactionResult> {
  logger.info('starting yjs compaction pass');

  const result: CompactionResult = {
    docsProcessed: 0,
    updatesCompacted: 0,
    updatesPruned: 0,
  };

  // Find docs that have at least one pending update.
  const docsWithUpdates = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT DISTINCT ydoc_id AS id
    FROM yjs_updates
  `;

  for (const { id: ydocId } of docsWithUpdates) {
    try {
      const compacted = await compactSingleDoc(ydocId);
      result.docsProcessed++;
      result.updatesCompacted += compacted;
    } catch (err: unknown) {
      // Log and continue — do not fail the whole pass on one doc.
      logger.error({ ydocId, err }, 'compaction failed for doc, skipping');
    }
  }

  // Prune old updates across all docs — belt-and-suspenders cleanup
  // for any rows that slipped through inline compaction.
  const cutoff = new Date(Date.now() - PRUNE_DAYS * 24 * 60 * 60 * 1_000);
  const pruned = await prisma.yjsUpdate.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  result.updatesPruned = pruned.count;

  logger.info(result, 'yjs compaction pass complete');
  return result;
}

// ─── Internal ──────────────────────────────────────────────────────────────

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

  return prisma.$transaction(async (tx) => {
    // Compare-and-swap on version (matches yjs-compaction.ts + yjs-persistence):
    // a third compaction path here must not blind-overwrite the snapshot. Abort
    // without deleting the update rows if another pass wrote it first. (Review.)
    const swapped = await tx.yjsDocument.updateMany({
      where: { id: ydocId, version: existing.version },
      data: { ydocBinary: encrypt(Buffer.from(mergedUpdate)), version: { increment: 1 } },
    });
    if (swapped.count !== 1) return 0;
    await tx.yjsUpdate.deleteMany({ where: { id: { in: updateIds } } });
    logger.debug({ ydocId, mergedCount: updateIds.length }, 'doc compacted');
    return updateIds.length;
  });
}

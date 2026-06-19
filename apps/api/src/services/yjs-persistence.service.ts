// Y.js persistence service.
//
// WHY append-only log + periodic snapshot:
//   Writing every incremental update as a separate row (YjsUpdate) keeps the
//   hot path fast (one INSERT per operation) and gives us full history for
//   catch-up on reconnect. The compaction worker merges rows into the parent
//   YjsDocument snapshot every 100 updates or 6 hours — whichever comes first.
//
// WHY Bytes column, not JSON:
//   Y.js update payloads are binary (Uint8Array). Encoding as base64 JSON
//   inflates size ≈33 % with no benefit. Postgres Bytes / bytea stores them
//   natively and Prisma surfaces them as Buffer.
//
// Encryption:
//   When PII_FIELD_ENCRYPTION=true the ydocBinary and update columns are
//   AES-256-GCM encrypted with the APP_SECRET key. The IV is prepended to
//   the ciphertext (12 bytes) so decrypt does not need separate storage.

import * as Y from 'yjs';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { prisma } from '@bidstack/db';
import { pino } from 'pino';

const logger = pino({ name: 'yjs-persistence.service' });

// ─── Encryption helpers ────────────────────────────────────────────────────

const ENCRYPTION_ENABLED = process.env.PII_FIELD_ENCRYPTION === 'true';
// Key must be 32 bytes (256 bit). Derive from APP_SECRET via first 32 hex chars.
const ENC_KEY_HEX = (process.env.APP_SECRET ?? '0'.repeat(64)).slice(0, 64);
const ENC_KEY = Buffer.from(ENC_KEY_HEX, 'hex');
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

function encrypt(plainBuf: Buffer): Buffer {
  if (!ENCRYPTION_ENABLED) return plainBuf;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', ENC_KEY, iv, {
    authTagLength: AUTH_TAG_BYTES,
  });
  const encrypted = Buffer.concat([cipher.update(plainBuf), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Layout: [12-byte IV][16-byte auth tag][ciphertext]
  return Buffer.concat([iv, authTag, encrypted]);
}

function decrypt(cipherBuf: Buffer): Buffer {
  if (!ENCRYPTION_ENABLED) return cipherBuf;
  const iv = cipherBuf.subarray(0, IV_BYTES);
  const authTag = cipherBuf.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
  const ciphertext = cipherBuf.subarray(IV_BYTES + AUTH_TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', ENC_KEY, iv, {
    authTagLength: AUTH_TAG_BYTES,
  });
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

// ─── Public API ────────────────────────────────────────────────────────────

export interface DocKey {
  orgId: string;
  entityType: string;
  entityId: string;
  fieldKey: string;
}

/**
 * Load or create a Y.Doc from the Postgres snapshot + pending updates.
 * Returns the hydrated Y.Doc and the ydocId for subsequent update writes.
 */
export async function loadYDoc(key: DocKey): Promise<{ doc: Y.Doc; ydocId: string }> {
  const existing = await prisma.yjsDocument.findUnique({
    where: {
      orgId_entityType_entityId_fieldKey: {
        orgId: key.orgId,
        entityType: key.entityType,
        entityId: key.entityId,
        fieldKey: key.fieldKey,
      },
    },
    include: {
      updates: { orderBy: { createdAt: 'asc' } },
    },
  });

  const doc = new Y.Doc();

  if (existing) {
    // Apply base snapshot first.
    const snapshotBytes = decrypt(Buffer.from(existing.ydocBinary));
    Y.applyUpdate(doc, new Uint8Array(snapshotBytes));

    // Then replay pending incremental updates in order.
    for (const row of existing.updates) {
      const updateBytes = decrypt(Buffer.from(row.update));
      Y.applyUpdate(doc, new Uint8Array(updateBytes));
    }

    return { doc, ydocId: existing.id };
  }

  // First access — create empty snapshot.
  const emptyUpdate = Y.encodeStateAsUpdate(doc);
  const created = await prisma.yjsDocument.create({
    data: {
      orgId: key.orgId,
      entityType: key.entityType,
      entityId: key.entityId,
      fieldKey: key.fieldKey,
      ydocBinary: encrypt(Buffer.from(emptyUpdate)),
    },
  });

  return { doc, ydocId: created.id };
}

/**
 * Load an EXISTING Y.Doc by its ydocId (org-scoped). Unlike {@link loadYDoc},
 * this never creates a row — it returns null when the doc does not exist, so a
 * sync against an unknown id fails cleanly instead of silently hydrating an
 * empty document. Used by the yjs:sync handler, which already knows the ydocId.
 */
export async function loadYDocById(ydocId: string, orgId: string): Promise<Y.Doc | null> {
  const existing = await prisma.yjsDocument.findFirst({
    where: { id: ydocId, orgId },
    include: { updates: { orderBy: { createdAt: 'asc' } } },
  });
  if (!existing) return null;

  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(decrypt(Buffer.from(existing.ydocBinary))));
  for (const row of existing.updates) {
    Y.applyUpdate(doc, new Uint8Array(decrypt(Buffer.from(row.update))));
  }
  return doc;
}

/**
 * Persist a single incremental Y.js update to the append-only log.
 * Also checks if compaction threshold (100 updates) is exceeded and
 * triggers inline compaction in that case to bound table growth.
 */
export async function persistUpdate(
  ydocId: string,
  orgId: string,
  clientId: string,
  update: Uint8Array,
): Promise<void> {
  await prisma.yjsUpdate.create({
    data: {
      ydocId,
      orgId,
      clientId,
      update: encrypt(Buffer.from(update)),
    },
  });

  // Inline compaction when the update count crosses the threshold.
  // WHY inline rather than always deferring to the background job:
  //   prevents unbounded row growth between 6-hour job windows.
  const count = await prisma.yjsUpdate.count({ where: { ydocId } });
  if (count >= 100) {
    compactDocInline(ydocId).catch((err: unknown) => {
      logger.error({ ydocId, err }, 'inline yjs compaction failed');
    });
  }
}

/**
 * Return all incremental updates for a doc created AFTER a given timestamp.
 * Used for catch-up: client sends its last-seen-ts, server replies with delta.
 */
export async function getUpdatesSince(
  ydocId: string,
  orgId: string,
  since: Date,
): Promise<Uint8Array[]> {
  const rows = await prisma.yjsUpdate.findMany({
    where: { ydocId, orgId, createdAt: { gt: since } },
    orderBy: { createdAt: 'asc' },
  });

  return rows.map((r) => new Uint8Array(decrypt(Buffer.from(r.update))));
}

/**
 * Merge all pending YjsUpdate rows into the parent YjsDocument snapshot.
 * Safe to call concurrently with the worker sweep: the snapshot write is a
 * compare-and-swap on YjsDocument.version, so a stale merge aborts instead of
 * blind-overwriting (which could lose a collaborative edit). (Review finding.)
 */
export async function compactDoc(ydocId: string): Promise<void> {
  await compactDocInline(ydocId);
}

// ─── Internal ──────────────────────────────────────────────────────────────

async function compactDocInline(ydocId: string): Promise<void> {
  const existing = await prisma.yjsDocument.findUnique({
    where: { id: ydocId },
    include: { updates: { orderBy: { createdAt: 'asc' } } },
  });

  if (!existing || existing.updates.length === 0) return;

  const doc = new Y.Doc();
  // Apply base snapshot.
  const snapshotBytes = decrypt(Buffer.from(existing.ydocBinary));
  Y.applyUpdate(doc, new Uint8Array(snapshotBytes));

  // Apply all pending updates.
  for (const row of existing.updates) {
    const updateBytes = decrypt(Buffer.from(row.update));
    Y.applyUpdate(doc, new Uint8Array(updateBytes));
  }

  // Encode merged state.
  const mergedUpdate = Y.encodeStateAsUpdate(doc);
  const updateIds = existing.updates.map((u) => u.id);

  const merged = await prisma.$transaction(async (tx) => {
    // Compare-and-swap on version — abort (don't delete the updates) if another
    // compaction wrote the snapshot since our read, so no edit is lost.
    const swapped = await tx.yjsDocument.updateMany({
      where: { id: ydocId, version: existing.version },
      data: { ydocBinary: encrypt(Buffer.from(mergedUpdate)), version: { increment: 1 } },
    });
    if (swapped.count !== 1) return 0;
    // Delete only the rows we merged — not any that arrived concurrently.
    await tx.yjsUpdate.deleteMany({ where: { id: { in: updateIds } } });
    return updateIds.length;
  });

  if (merged === 0) {
    logger.debug({ ydocId }, 'yjs compaction skipped — version changed (concurrent pass won)');
    return;
  }
  logger.info({ ydocId, mergedCount: merged }, 'yjs doc compacted');
}

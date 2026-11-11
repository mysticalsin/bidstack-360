// Starts that carry a client uploadId (start-csv, start-hubspot).

import { prisma } from '@bidstack/db';

// Covers the wait for a start in flight plus that start's enqueue and writes.
const UPLOAD_LOCK_TIMEOUT_MS = 30_000;

/**
 * Runs the starts that carry the same uploadId one after another, across API
 * instances: a retry sent while the first attempt is still running waits for
 * it, then finds its job instead of starting a second import. The lock is
 * transaction-scoped and `run` writes on autocommit, so the next holder sees
 * those writes. The unique (org, uploadId) index backs this up.
 */
export function withUploadLock<T>(orgId: string, uploadId: string, run: () => Promise<T>): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`migration-start:${orgId}:${uploadId}`}))`;
      return run();
    },
    { maxWait: UPLOAD_LOCK_TIMEOUT_MS, timeout: UPLOAD_LOCK_TIMEOUT_MS },
  );
}

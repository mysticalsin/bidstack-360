// Producer-side handle for the `document-extract` queue.
// Route handlers enqueue jobs; the worker in apps/worker performs the actual
// text extraction + LLM call + DB writeback.

import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { prisma } from '@bidstack/db';
import { createLogger } from '../lib/logger.js';

import { DOCUMENT_EXTRACT } from '@bidstack/shared';

const log = createLogger({ name: 'queue:document-extract' });

export const DOCUMENT_EXTRACT_QUEUE = DOCUMENT_EXTRACT.name;

export interface DocumentExtractJob {
  orgId: string;
  accountId: string;
  documentId: string;
  extractionId: string;
  storageKey: string;
  contentType: string;
  name: string;
  opportunityId?: string;
  bidDocumentId?: string;
  documentVersionId?: string;
  /** Optional custom prompt override. */
  prompt?: string;
}

let queueSingleton: Queue | null = null;
let connectionSingleton: IORedis | null = null;

function getQueue(): Queue {
  if (queueSingleton) return queueSingleton;

  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6380';
  connectionSingleton = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    enableOfflineQueue: true,
    lazyConnect: false,
  });
  // Log Redis errors so queue failures are visible in logs/metrics.
  connectionSingleton.on('error', (err) => {
    log.error({ err }, 'Redis connection error in document-extract queue');
  });

  queueSingleton = new Queue(DOCUMENT_EXTRACT_QUEUE, {
    connection: connectionSingleton,
    defaultJobOptions: DOCUMENT_EXTRACT.defaultJobOptions,
  });
  return queueSingleton;
}

/**
 * NDA-D gate: silently skip documents marked NDA tier D (never-in-AI).
 *
 * WHY: NDA-D content is contractually forbidden from any AI processing.
 * Silent skip (not error) to avoid revealing existence of the document to logs.
 * Returns true if safe to proceed, false if the document must be skipped.
 *
 * Schema note: the legacy `Document` model has no ndaTier column. NDA tier is
 * stored in `BidDocument.metadata.ndaTier` (Json field) introduced in Wave 9.
 * The documentId param corresponds to the BidDocument id when present.
 * If no BidDocument is found (legacy document flow), we treat as safe.
 */
export async function isDocumentAiSafe(documentId: string, orgId: string): Promise<boolean> {
  const doc = await prisma.bidDocument.findFirst({
    where: { id: documentId, orgId },
    select: { metadata: true },
  });

  // Missing document: treated as safe — will fail later on actual access attempt
  if (!doc) return true;

  // WHY type assertion: metadata is Json (unknown shape); we read a single known key
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- metadata is untyped Json from Prisma
  const meta = doc.metadata as any;
  if (meta && meta.ndaTier === 'D') {
    // Do NOT log document ID or name — NDA-D existence must not be leaked to log aggregators
    return false;
  }

  return true;
}

/**
 * Enqueue a document extraction job. Returns the BullMQ job id, or null if
 * Redis is unreachable (fail-open so the API route still responds).
 */
export async function enqueueDocumentExtract(job: DocumentExtractJob): Promise<string | null> {
  if (process.env.NODE_ENV === 'test' && process.env.BIDSTACK_ENABLE_QUEUE_IN_TESTS !== 'true') {
    log.info(
      { orgId: job.orgId, documentId: job.documentId },
      'Document extract enqueue skipped in test mode',
    );
    return null;
  }
  try {
    const queued = await getQueue().add('document.extract', job, {
      jobId: [job.orgId, job.documentId, job.bidDocumentId ?? job.extractionId].join('--'),
    });
    log.info(
      { jobId: queued.id, orgId: job.orgId, documentId: job.documentId },
      'Document extract job enqueued',
    );
    return queued.id ?? null;
  } catch (err) {
    log.error(
      { err, orgId: job.orgId, documentId: job.documentId },
      'Failed to enqueue document extract job',
    );
    return null;
  }
}

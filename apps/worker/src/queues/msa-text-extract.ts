/**
 * MSA library text extraction worker (queue `msa-text-extract`).
 *
 * One job per contract file version. Re-reads the version by (orgId, id) so a
 * forged or stale payload cannot cross tenants, reads the stored bytes, runs
 * the sandboxed extractor, and stores the text for the GIN full-text index on
 * contract_file_versions. No LLM call: MSA text is only indexed, never sent out.
 */

import { Worker, type Job, type Queue } from 'bullmq';
import type IORedis from 'ioredis';
import type pino from 'pino';

import { prisma } from '@bidstack/db';
import { MSA_TEXT_EXTRACT, type MsaTextExtractJob } from '@bidstack/shared';

import { extractTextFromBufferSandboxed } from '../lib/extract-text-sandbox.js';
import { readStoredDocument } from '../lib/storage-read.js';

/**
 * Postgres caps a tsvector at 1 MB, and a full MSA rarely exceeds ~300k chars.
 * Anything longer is truncated (and flagged) so indexing never fails.
 */
export const MSA_MAX_INDEXED_CHARS = 400_000;

export interface MsaExtractDeps {
  read: (args: { orgId: string; storageKey: string }) => Promise<{ buffer: Buffer; sourcePath?: string }>;
  extract: (args: { buffer: Buffer; contentType: string; name: string; sourcePath?: string }) => Promise<string>;
}

const defaultDeps: MsaExtractDeps = {
  read: readStoredDocument,
  extract: (args) => extractTextFromBufferSandboxed(args),
};

/** NULs are illegal in Postgres text; collapse runs of whitespace; cap length. */
export function normalizeExtractedText(raw: string): { text: string; truncated: boolean } {
  // eslint-disable-next-line no-control-regex
  const cleaned = raw.replace(/\u0000/g, '').replace(/[ \t\f\v]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (cleaned.length <= MSA_MAX_INDEXED_CHARS) return { text: cleaned, truncated: false };
  return { text: cleaned.slice(0, MSA_MAX_INDEXED_CHARS), truncated: true };
}

export type MsaExtractOutcome = 'done' | 'skipped' | 'failed';

export async function processMsaTextExtract(
  data: MsaTextExtractJob,
  deps: MsaExtractDeps = defaultDeps,
  opts: { finalAttempt?: boolean } = {},
): Promise<MsaExtractOutcome> {
  const version = await prisma.contractFileVersion.findFirst({
    where: { id: data.versionId, orgId: data.orgId, contractId: data.contractId, deletedAt: null },
    select: {
      id: true,
      fileName: true,
      contentType: true,
      fileAttachment: { select: { storageKey: true } },
    },
  });
  if (!version) return 'skipped';

  await prisma.contractFileVersion.updateMany({
    where: { id: version.id, orgId: data.orgId },
    data: { extractionStatus: 'running', extractionError: null },
  });
  try {
    const stored = await deps.read({ orgId: data.orgId, storageKey: version.fileAttachment.storageKey });
    const raw = await deps.extract({
      buffer: stored.buffer,
      contentType: version.contentType,
      name: version.fileName,
      ...(stored.sourcePath ? { sourcePath: stored.sourcePath } : {}),
    });
    const { text, truncated } = normalizeExtractedText(raw);
    await prisma.contractFileVersion.updateMany({
      where: { id: version.id, orgId: data.orgId },
      data: {
        extractedText: text,
        extractionStatus: 'done',
        extractionError: truncated ? `truncated to ${MSA_MAX_INDEXED_CHARS} characters` : null,
        extractedAt: new Date(),
      },
    });
    return 'done';
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.contractFileVersion.updateMany({
      where: { id: version.id, orgId: data.orgId },
      data: {
        // Retries go back to pending; only the last attempt leaves `error`.
        extractionStatus: opts.finalAttempt === false ? 'pending' : 'error',
        extractionError: message.slice(0, 500),
      },
    });
    if (opts.finalAttempt === false) throw err;
    return 'failed';
  }
}

export function startMsaTextExtract(
  connection: IORedis,
  log: pino.Logger,
  workers: Worker[],
  _queues: Queue[],
): void {
  const worker = new Worker<MsaTextExtractJob>(
    MSA_TEXT_EXTRACT.name,
    async (job: Job<MsaTextExtractJob>) => {
      const attempts = job.opts.attempts ?? 1;
      const finalAttempt = job.attemptsMade + 1 >= attempts;
      const outcome = await processMsaTextExtract(job.data, defaultDeps, { finalAttempt });
      log.info({ jobId: job.id, orgId: job.data.orgId, outcome }, 'msa text extract finished');
      return { outcome };
    },
    { connection, concurrency: 2 },
  );
  worker.on('failed', (job, err) => {
    log.warn({ jobId: job?.id, err: err.message }, 'msa text extract attempt failed');
  });
  workers.push(worker);
}

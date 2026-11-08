// One "Sync now" run for an AgreementSource (slice 13a). Lists what changed
// since the stored cursor, lands one AgreementIngestItem per new file or new
// file version, and runs each through the intake pipeline. The run state is
// kept on the source row (lastRunId + lastResult) so the UI can poll it.
//
// Progress is resumable: files already landed never use the per-run budget,
// a run that stops mid-feed stores the page it stopped on, and the committed
// cursor only moves once the feed is fully read and no retryable failure is
// outstanding. Retryable failures (network, 5xx, storage, database) are tried
// again by id with backoff and dead-lettered after MAX_SOURCE_ATTEMPTS;
// definitive ones (bad file, too large, gone) are rejected.
import { prisma, Prisma } from '@bidstack/db';
import {
  AGREEMENT_INGEST_MAX_BYTES,
  DocuSignSourceConfig,
  SharePointSourceConfig,
  type AgreementSyncResult,
  type AgreementSyncRun,
} from '@bidstack/shared';

import { createLogger } from '../../lib/logger.js';
import { IngestRejectedError, ITEM_FOR_PROCESS, processAgreementBytes, type ItemForProcess, type ProcessOutcome } from '../agreement-ingest/process.js';
import { ConnectionError, resolveSourceAccess, type SourceAccess } from './connections.js';
import { DocuSignError, downloadCombinedPdf, listCompletedEnvelopes } from './docusign-envelopes.js';
import { downloadDriveItem, GraphDriveError, listDriveDeltaPage, type FetchFn } from './graph-drive.js';

const log = createLogger({ name: 'agreement-sources:sync' });

export const MAX_FILES_PER_RUN = 200;
export const MAX_SOURCE_ATTEMPTS = 5;
const MAX_PAGES_PER_RUN = 50;
const RETRY_BATCH = 50;
const RETRY_BASE_MS = 5 * 60_000;
const RETRY_MAX_MS = 24 * 60 * 60_000;
const DOCUSIGN_DEFAULT_LOOKBACK_DAYS = 90;

export interface SyncDeps {
  fetch?: FetchFn;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
}

type Source = {
  id: string;
  orgId: string;
  kind: string;
  enabled: boolean;
  config: Prisma.JsonValue;
  cursor: string | null;
  progress: Prisma.JsonValue | null;
  connectionId: string | null;
  createdById: string;
};

type ItemStatus = ProcessOutcome['status'];

type Progress = { next?: string; delta?: string };

function parseProgress(value: Prisma.JsonValue | null): Progress {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const v = value as Record<string, unknown>;
  return {
    ...(typeof v.next === 'string' ? { next: v.next } : {}),
    ...(typeof v.delta === 'string' ? { delta: v.delta } : {}),
  };
}

function emptyResult(): AgreementSyncResult {
  return { new: 0, updated: 0, skipped: 0, failed: 0 };
}

function tally(result: AgreementSyncResult, outcome: ItemStatus): void {
  if (outcome === 'drafted') result.new += 1;
  else if (outcome === 'versioned') result.updated += 1;
  else if (outcome === 'duplicate' || outcome === 'skipped') result.skipped += 1;
  else result.failed += 1;
}

/** Network errors, timeouts, throttling, 5xx and anything outside the provider (storage, database) are worth retrying. */
export function isRetryableError(err: unknown): boolean {
  if (err instanceof IngestRejectedError) return false;
  if (err instanceof GraphDriveError || err instanceof DocuSignError) {
    if (err.status === null) return true;
    return err.status === 408 || err.status === 429 || err.status >= 500;
  }
  return true;
}

export function retryDelayMs(attempts: number): number {
  return Math.min(RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1), RETRY_MAX_MS);
}

export function runStateFromJson(value: Prisma.JsonValue | null, sourceId: string): AgreementSyncRun | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.runId !== 'string') return null;
  return {
    runId: v.runId,
    sourceId,
    state: (['queued', 'running', 'completed', 'failed'] as const).find((s) => s === v.state) ?? 'failed',
    startedAt: typeof v.startedAt === 'string' ? v.startedAt : null,
    finishedAt: typeof v.finishedAt === 'string' ? v.finishedAt : null,
    result: v.result && typeof v.result === 'object' ? (v.result as AgreementSyncResult) : null,
    reasons: Array.isArray(v.reasons) ? v.reasons.filter((r): r is string => typeof r === 'string') : [],
  };
}

async function saveRun(source: Source, run: AgreementSyncRun, extra: Prisma.AgreementSourceUpdateInput = {}): Promise<void> {
  await prisma.agreementSource.update({
    where: { id: source.id },
    data: { lastRunId: run.runId, lastResult: run as unknown as Prisma.InputJsonValue, ...extra },
  });
}

/**
 * Claim the next run. `seenUpdatedAt` is the source row version the caller
 * checked; a concurrent Sync now that got there first makes this return null.
 */
export async function markRunQueued(
  sourceId: string,
  orgId: string,
  runId: string,
  seenUpdatedAt?: Date,
): Promise<AgreementSyncRun | null> {
  const run: AgreementSyncRun = { runId, sourceId, state: 'queued', startedAt: null, finishedAt: null, result: null, reasons: [] };
  const res = await prisma.agreementSource.updateMany({
    where: { id: sourceId, orgId, ...(seenUpdatedAt ? { updatedAt: seenUpdatedAt } : {}) },
    data: { lastRunId: runId, lastResult: run as unknown as Prisma.InputJsonValue },
  });
  return res.count === 1 ? run : null;
}

async function auditItem(source: Source, itemId: string, action: string, diff: Record<string, unknown>) {
  await prisma.auditLog
    .create({
      data: { orgId: source.orgId, userId: null, action, targetType: 'agreement_ingest_item', targetId: itemId, diff: { sourceId: source.id, ...diff } as Prisma.InputJsonValue },
    })
    .catch((err: unknown) => log.warn({ itemId, err: err instanceof Error ? err.message : String(err) }, 'agreement item audit failed'));
}

/** Retryable: back off, or dead-letter once the attempt cap is reached. The row stays `failed`. */
async function scheduleRetry(source: Source, itemId: string, attempts: number, message: string, now: Date): Promise<'failed'> {
  const dead = attempts >= MAX_SOURCE_ATTEMPTS;
  await prisma.agreementIngestItem.updateMany({
    where: { id: itemId, orgId: source.orgId, status: { in: ['processing', 'failed'] } },
    data: {
      status: 'failed',
      error: message.slice(0, 500),
      processedAt: now,
      nextAttemptAt: dead ? null : new Date(now.getTime() + retryDelayMs(attempts)),
      deadLetteredAt: dead ? now : null,
    },
  });
  log.warn({ sourceId: source.id, itemId, attempts, dead, err: message.slice(0, 200) }, 'agreement source item failed');
  if (dead) await auditItem(source, itemId, 'agreement.ingest.dead_lettered', { attempts, reason: message.slice(0, 300) });
  return 'failed';
}

async function settleError(source: Source, itemId: string, attempts: number, err: unknown, fallback: string, now: Date): Promise<ItemStatus> {
  const message = err instanceof Error ? err.message : fallback;
  if (isRetryableError(err)) return scheduleRetry(source, itemId, attempts, message, now);
  await prisma.agreementIngestItem.updateMany({
    where: { id: itemId, orgId: source.orgId, status: 'processing' },
    data: { status: 'rejected', error: message.slice(0, 500), processedAt: now, nextAttemptAt: null },
  });
  await auditItem(source, itemId, 'agreement.ingest.rejected', { reason: message.slice(0, 300) });
  return 'rejected';
}

/** Download and process one claimed item. Never throws. */
async function runItem(source: Source, item: ItemForProcess, attempts: number, download: () => Promise<Buffer>, now: () => Date): Promise<ItemStatus> {
  let buf: Buffer;
  try {
    buf = await download();
  } catch (err) {
    return settleError(source, item.id, attempts, err, 'Download failed', now());
  }
  try {
    const outcome = await processAgreementBytes(item, buf);
    // "failed" here means no reviewer exists yet; that can change, so retry.
    if (outcome.status === 'failed') return scheduleRetry(source, item.id, attempts, outcome.error ?? 'Processing failed', now());
    return outcome.status;
  } catch (err) {
    return settleError(source, item.id, attempts, err, 'Processing failed', now());
  }
}

type RemoteFile = { externalSource: string; externalId: string; externalVersion: string | null; fileName: string; metadata: Record<string, unknown> };

const versionKey = (id: string, version: string | null) => `${id}\u0000${version ?? ''}`;

/** Files already landed (any status) for these external ids; they never use the run budget. */
async function landedKeys(orgId: string, externalSource: string, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await prisma.agreementIngestItem.findMany({
    where: { orgId, externalSource, externalId: { in: ids } },
    select: { externalId: true, externalVersion: true },
    take: 1000,
  });
  return new Set(rows.map((r) => versionKey(r.externalId, r.externalVersion)));
}

async function landAndProcess(source: Source, file: RemoteFile, download: () => Promise<Buffer>, now: () => Date): Promise<ItemStatus> {
  const seen = await prisma.agreementIngestItem.findFirst({
    where: { orgId: source.orgId, externalSource: file.externalSource, externalId: file.externalId, externalVersion: file.externalVersion },
    select: { id: true },
  });
  if (seen) return 'skipped';
  const item = await prisma.agreementIngestItem.create({
    data: {
      orgId: source.orgId,
      sourceId: source.id,
      channel: source.kind,
      externalSource: file.externalSource,
      externalId: file.externalId,
      externalVersion: file.externalVersion,
      fileName: file.fileName.slice(0, 255),
      metadata: file.metadata as Prisma.InputJsonValue,
      status: 'processing',
      attempts: 1,
      actorType: 'source',
      actorId: source.id,
    },
    select: ITEM_FOR_PROCESS,
  });
  await auditItem(source, item.id, 'agreement.ingest.received', { channel: source.kind, externalSource: file.externalSource, externalId: file.externalId });
  return runItem(source, item, 1, download, now);
}

/** Retry due failures by id; the feed will not list them again. */
async function retryDue(source: Source, result: AgreementSyncResult, download: (externalId: string) => Promise<Buffer>, now: () => Date) {
  const rows = await prisma.agreementIngestItem.findMany({
    where: {
      orgId: source.orgId,
      sourceId: source.id,
      status: 'failed',
      deadLetteredAt: null,
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now() } }],
    },
    orderBy: { createdAt: 'asc' },
    take: RETRY_BATCH,
    select: { ...ITEM_FOR_PROCESS, attempts: true },
  });
  for (const { attempts, ...item } of rows) {
    const claimed = await prisma.agreementIngestItem.updateMany({
      where: { id: item.id, orgId: source.orgId, status: 'failed', deadLetteredAt: null },
      data: { status: 'processing', attempts: { increment: 1 }, error: null },
    });
    if (claimed.count !== 1) continue;
    tally(result, await runItem(source, item, attempts + 1, () => download(item.externalId), now));
  }
}

async function outstandingFailures(source: Source): Promise<number> {
  return prisma.agreementIngestItem.count({
    where: { orgId: source.orgId, sourceId: source.id, status: { in: ['failed', 'processing'] }, deadLetteredAt: null },
  });
}

type SyncOutcome = { cursor: string | null; progress: Progress | null };

async function syncSharePoint(
  source: Source,
  access: Extract<SourceAccess, { kind: 'sharepoint' }>,
  deps: Required<SyncDeps>,
  result: AgreementSyncResult,
  reasons: string[],
): Promise<SyncOutcome> {
  const config = SharePointSourceConfig.parse(source.config);
  const externalSource = `sharepoint:${config.driveId}`.slice(0, 120);
  const download = (itemId: string) =>
    downloadDriveItem(deps.fetch, access.token, { driveId: config.driveId, itemId, maxBytes: AGREEMENT_INGEST_MAX_BYTES });
  await retryDue(source, result, download, deps.now);

  const progress = parseProgress(source.progress);
  let url: string | null = progress.next ?? progress.delta ?? source.cursor ?? null;
  let budget = MAX_FILES_PER_RUN;
  let finalDelta: string | null = null;
  for (let page = 0; page < MAX_PAGES_PER_RUN && !finalDelta; page += 1) {
    const step = await listDriveDeltaPage(deps.fetch, access.token, { driveId: config.driveId, folderPath: config.folderPath, url });
    const landed = await landedKeys(source.orgId, externalSource, step.files.map((f) => f.id));
    for (const file of step.files) {
      if (landed.has(versionKey(file.id, file.version))) {
        result.skipped += 1;
        continue;
      }
      if (budget === 0) {
        // Re-read this page next run; what landed here is skipped for free.
        reasons.push(`Pulled ${MAX_FILES_PER_RUN} files; the next run continues where this one stopped`);
        return { cursor: source.cursor, progress: { next: step.url } };
      }
      budget -= 1;
      const status = await landAndProcess(
        source,
        {
          externalSource,
          externalId: file.id,
          externalVersion: file.version,
          fileName: file.name,
          metadata: { title: file.name.replace(/\.(pdf|docx)$/i, ''), sourceUrl: file.webUrl ?? undefined },
        },
        () => download(file.id),
        deps.now,
      );
      tally(result, status);
    }
    if (step.deltaLink) finalDelta = step.deltaLink;
    else url = step.nextLink;
  }
  if (!finalDelta) {
    reasons.push('The change feed is long; the next run continues where this one stopped');
    return { cursor: source.cursor, progress: url ? { next: url } : null };
  }
  const outstanding = await outstandingFailures(source);
  if (outstanding > 0) {
    reasons.push(`${outstanding} file(s) will be retried; the cursor waits for them`);
    return { cursor: source.cursor, progress: { delta: finalDelta } };
  }
  return { cursor: finalDelta, progress: null };
}

async function syncDocuSign(
  source: Source,
  access: Extract<SourceAccess, { kind: 'docusign' }>,
  deps: Required<SyncDeps>,
  result: AgreementSyncResult,
  reasons: string[],
): Promise<SyncOutcome> {
  const config = DocuSignSourceConfig.parse(source.config);
  const account = { baseUrl: access.baseUrl, accountId: access.accountId };
  const externalSource = `docusign:${access.accountId}`.slice(0, 120);
  const download = (envelopeId: string) => downloadCombinedPdf(deps.fetch, access.token, account, envelopeId, AGREEMENT_INGEST_MAX_BYTES);
  await retryDue(source, result, download, deps.now);

  const fallback = new Date(deps.now().getTime() - DOCUSIGN_DEFAULT_LOOKBACK_DAYS * 86_400_000).toISOString();
  const fromDate = source.cursor ?? (config.fromDate ? new Date(config.fromDate).toISOString() : fallback);
  const envelopes = await listCompletedEnvelopes(deps.fetch, access.token, account, {
    fromDate,
    templateId: config.templateId,
    folderId: config.folderId,
    keyword: config.keyword,
  });
  const landed = await landedKeys(source.orgId, externalSource, envelopes.map((e) => e.envelopeId));
  let cursor = source.cursor;
  let blocked = false;
  let budget = MAX_FILES_PER_RUN;
  for (const env of envelopes) {
    let status: ItemStatus = 'skipped';
    if (landed.has(versionKey(env.envelopeId, null))) {
      result.skipped += 1;
    } else if (budget === 0) {
      reasons.push(`Pulled ${MAX_FILES_PER_RUN} envelopes; the next run continues where this one stopped`);
      break;
    } else {
      budget -= 1;
      status = await landAndProcess(
        source,
        {
          externalSource,
          externalId: env.envelopeId,
          externalVersion: null,
          fileName: `${env.subject.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 200) || env.envelopeId}.pdf`,
          metadata: {
            title: env.subject,
            ...(env.counterparty ? { counterparty: env.counterparty } : {}),
            ...(env.completedAt ? { signedAt: env.completedAt } : {}),
          },
        },
        () => download(env.envelopeId),
        deps.now,
      );
      tally(result, status);
    }
    // The cursor never moves past a failed envelope, so it is listed again.
    if (status === 'failed') blocked = true;
    if (!blocked && env.completedAt && (!cursor || env.completedAt > cursor)) cursor = env.completedAt;
  }
  const outstanding = await outstandingFailures(source);
  if (outstanding > 0) {
    reasons.push(`${outstanding} envelope(s) will be retried; the cursor waits for them`);
    return { cursor: source.cursor, progress: null };
  }
  return { cursor, progress: null };
}

/** Execute one run. Errors end the run as failed; they never throw to the queue. */
export async function runAgreementSourceSync(
  job: { orgId: string; sourceId: string; runId: string },
  deps: SyncDeps = {},
): Promise<AgreementSyncRun> {
  const full: Required<SyncDeps> = {
    fetch: deps.fetch ?? fetch,
    env: deps.env ?? process.env,
    now: deps.now ?? (() => new Date()),
  };
  const source = await prisma.agreementSource.findFirst({
    where: { id: job.sourceId, orgId: job.orgId, deletedAt: null },
    select: { id: true, orgId: true, kind: true, enabled: true, config: true, cursor: true, progress: true, connectionId: true, createdById: true },
  });
  const startedAt = full.now().toISOString();
  if (!source) {
    return { runId: job.runId, sourceId: job.sourceId, state: 'failed', startedAt, finishedAt: startedAt, result: null, reasons: ['Source not found'] };
  }
  const result = emptyResult();
  const reasons: string[] = [];
  const running: AgreementSyncRun = { runId: job.runId, sourceId: source.id, state: 'running', startedAt, finishedAt: null, result: null, reasons };
  if (!source.enabled) {
    const done = { ...running, state: 'failed' as const, finishedAt: startedAt, reasons: ['Source is turned off'] };
    await saveRun(source, done);
    return done;
  }
  await saveRun(source, running);
  try {
    const access = await resolveSourceAccess(source, { fetch: full.fetch, env: full.env });
    const out =
      access.kind === 'sharepoint'
        ? await syncSharePoint(source, access, full, result, reasons)
        : await syncDocuSign(source, access, full, result, reasons);
    const done: AgreementSyncRun = { ...running, state: 'completed', finishedAt: full.now().toISOString(), result, reasons };
    await saveRun(source, done, {
      cursor: out.cursor,
      progress: out.progress ? (out.progress as Prisma.InputJsonValue) : Prisma.DbNull,
      lastSyncAt: full.now(),
    });
    return done;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Sync failed';
    log.warn({ sourceId: source.id, err: message, code: err instanceof ConnectionError ? err.code : undefined }, 'agreement source sync failed');
    const done: AgreementSyncRun = { ...running, state: 'failed', finishedAt: full.now().toISOString(), result, reasons: [...reasons, message.slice(0, 300)] };
    await saveRun(source, done, { lastSyncAt: full.now() });
    return done;
  }
}

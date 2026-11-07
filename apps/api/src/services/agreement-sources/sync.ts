// One "Sync now" run for an AgreementSource (slice 13a). Lists what changed
// since the stored cursor, lands one AgreementIngestItem per new file or new
// file version, and runs each through the intake pipeline. The run state is
// kept on the source row (lastRunId + lastResult) so the UI can poll it.
import { prisma, type Prisma } from '@bidstack/db';
import {
  AGREEMENT_INGEST_MAX_BYTES,
  DocuSignSourceConfig,
  isAgreementFileName,
  SharePointSourceConfig,
  type AgreementSyncResult,
  type AgreementSyncRun,
} from '@bidstack/shared';

import { createLogger } from '../../lib/logger.js';
import { ITEM_FOR_PROCESS, processAgreementBytes, type ProcessOutcome } from '../agreement-ingest/process.js';
import {
  docuSignCredentialsFromEnv,
  downloadCombinedPdf,
  getDocuSignToken,
  listCompletedEnvelopes,
} from './docusign-envelopes.js';
import { downloadDriveItem, getGraphAppToken, graphCredentialsFromEnv, listDriveDelta, type FetchFn } from './graph-drive.js';

const log = createLogger({ name: 'agreement-sources:sync' });

const MAX_FILES_PER_RUN = 200;
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
  createdById: string;
};

function emptyResult(): AgreementSyncResult {
  return { new: 0, updated: 0, skipped: 0, failed: 0 };
}

function tally(result: AgreementSyncResult, outcome: ProcessOutcome['status']): void {
  if (outcome === 'drafted') result.new += 1;
  else if (outcome === 'versioned') result.updated += 1;
  else if (outcome === 'duplicate' || outcome === 'skipped') result.skipped += 1;
  else result.failed += 1;
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

/** Mark a run queued before the job is picked up (the route calls this). */
export async function markRunQueued(sourceId: string, orgId: string, runId: string): Promise<AgreementSyncRun> {
  const run: AgreementSyncRun = { runId, sourceId, state: 'queued', startedAt: null, finishedAt: null, result: null, reasons: [] };
  await prisma.agreementSource.updateMany({
    where: { id: sourceId, orgId },
    data: { lastRunId: runId, lastResult: run as unknown as Prisma.InputJsonValue },
  });
  return run;
}

async function landAndProcess(
  source: Source,
  file: { externalSource: string; externalId: string; externalVersion: string | null; fileName: string; metadata: Record<string, unknown> },
  download: () => Promise<Buffer>,
): Promise<ProcessOutcome['status']> {
  const seen = await prisma.agreementIngestItem.findFirst({
    where: {
      orgId: source.orgId,
      externalSource: file.externalSource,
      externalId: file.externalId,
      externalVersion: file.externalVersion,
      status: { notIn: ['failed'] },
    },
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
  await prisma.auditLog.create({
    data: {
      orgId: source.orgId,
      userId: null,
      action: 'agreement.ingest.received',
      targetType: 'agreement_ingest_item',
      targetId: item.id,
      diff: { channel: source.kind, externalSource: file.externalSource, externalId: file.externalId, sourceId: source.id },
    },
  });
  try {
    const buf = await download();
    return (await processAgreementBytes(item, buf)).status;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Download failed';
    await prisma.agreementIngestItem.update({
      where: { id: item.id },
      data: { status: 'failed', error: message.slice(0, 500), processedAt: new Date() },
    });
    log.warn({ sourceId: source.id, itemId: item.id, err: message }, 'agreement source item failed');
    return 'failed';
  }
}

async function syncSharePoint(source: Source, deps: Required<SyncDeps>, result: AgreementSyncResult, reasons: string[]) {
  const config = SharePointSourceConfig.parse(source.config);
  const creds = graphCredentialsFromEnv(deps.env);
  if (!creds) throw new Error('Microsoft Graph app credentials are not configured');
  const token = await getGraphAppToken(deps.fetch, creds);
  const delta = await listDriveDelta(deps.fetch, token, {
    driveId: config.driveId,
    folderPath: config.folderPath,
    deltaLink: source.cursor,
  });
  const files = delta.files.filter((f) => isAgreementFileName(f.name));
  result.skipped += delta.files.length - files.length;
  if (files.length > MAX_FILES_PER_RUN) reasons.push(`Only the first ${MAX_FILES_PER_RUN} files were pulled; run again for the rest`);
  for (const file of files.slice(0, MAX_FILES_PER_RUN)) {
    const status = await landAndProcess(
      source,
      {
        externalSource: `sharepoint:${config.driveId}`.slice(0, 120),
        externalId: file.id,
        externalVersion: file.version,
        fileName: file.name,
        metadata: { title: file.name.replace(/\.(pdf|docx)$/i, ''), sourceUrl: file.webUrl ?? undefined },
      },
      () => downloadDriveItem(deps.fetch, token, { driveId: config.driveId, itemId: file.id, maxBytes: AGREEMENT_INGEST_MAX_BYTES }),
    );
    tally(result, status);
  }
  return files.length > MAX_FILES_PER_RUN ? source.cursor : delta.deltaLink;
}

async function syncDocuSign(source: Source, deps: Required<SyncDeps>, result: AgreementSyncResult) {
  const config = DocuSignSourceConfig.parse(source.config);
  const creds = docuSignCredentialsFromEnv(deps.env);
  if (!creds) throw new Error('DocuSign credentials are not configured');
  const token = await getDocuSignToken(deps.fetch, creds);
  const fallback = new Date(deps.now().getTime() - DOCUSIGN_DEFAULT_LOOKBACK_DAYS * 86_400_000).toISOString();
  const fromDate = source.cursor ?? (config.fromDate ? new Date(config.fromDate).toISOString() : fallback);
  const envelopes = await listCompletedEnvelopes(deps.fetch, token, creds, {
    fromDate,
    templateId: config.templateId,
    folderId: config.folderId,
    keyword: config.keyword,
  });
  let cursor = source.cursor;
  for (const env of envelopes.slice(0, MAX_FILES_PER_RUN)) {
    const status = await landAndProcess(
      source,
      {
        externalSource: `docusign:${creds.accountId}`.slice(0, 120),
        externalId: env.envelopeId,
        externalVersion: null,
        fileName: `${env.subject.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 200) || env.envelopeId}.pdf`,
        metadata: {
          title: env.subject,
          ...(env.counterparty ? { counterparty: env.counterparty } : {}),
          ...(env.completedAt ? { signedAt: env.completedAt } : {}),
        },
      },
      () => downloadCombinedPdf(deps.fetch, token, creds, env.envelopeId, AGREEMENT_INGEST_MAX_BYTES),
    );
    tally(result, status);
    if (env.completedAt && (!cursor || env.completedAt > cursor)) cursor = env.completedAt;
  }
  return cursor;
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
    select: { id: true, orgId: true, kind: true, enabled: true, config: true, cursor: true, createdById: true },
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
    const cursor = source.kind === 'sharepoint'
      ? await syncSharePoint(source, full, result, reasons)
      : await syncDocuSign(source, full, result);
    const done: AgreementSyncRun = { ...running, state: 'completed', finishedAt: full.now().toISOString(), result, reasons };
    await saveRun(source, done, { cursor, lastSyncAt: full.now() });
    return done;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Sync failed';
    log.warn({ sourceId: source.id, err: message }, 'agreement source sync failed');
    const done: AgreementSyncRun = { ...running, state: 'failed', finishedAt: full.now().toISOString(), result, reasons: [...reasons, message.slice(0, 300)] };
    await saveRun(source, done, { lastSyncAt: full.now() });
    return done;
  }
}

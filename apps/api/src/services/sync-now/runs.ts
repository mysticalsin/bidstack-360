// Pure mapping from queue state to the SyncRun shape the "Sync now" control
// polls. No I/O here so every state transition is unit-tested.

import { createHash } from 'node:crypto';

import type { SyncRun, SyncSource } from '@bidstack/shared';

/** Deterministic run id: same org + source + idempotency key, same run. */
export function syncRunId(orgId: string, source: SyncSource, idempotencyKey: string): string {
  const digest = createHash('sha256')
    .update(`${orgId}\u0000${source}\u0000${idempotencyKey}`)
    .digest('hex')
    .slice(0, 32);
  // BullMQ rejects custom job ids containing ':'; hex + '-' is always safe.
  return `${source}-${digest}`;
}

export interface DustJobSnapshot {
  id: string;
  state: string;
  progress: unknown;
  timestamp: number;
  processedOn?: number;
  finishedOn?: number;
  returnvalue?: unknown;
  failedReason?: string;
}

const iso = (ms: number | undefined | null) => (ms ? new Date(ms).toISOString() : null);
const MAX_REASONS = 10;

function dustState(state: string): SyncRun['state'] {
  if (state === 'completed') return 'completed';
  if (state === 'failed') return 'failed';
  if (state === 'active') return 'running';
  return 'queued';
}

export function dustRunFromJob(job: DustJobSnapshot): SyncRun {
  const state = dustState(job.state);
  const rv = (job.returnvalue ?? null) as {
    created?: number;
    updated?: number;
    skipped?: number;
    errors?: number;
    reason?: string;
  } | null;
  const progress =
    state === 'completed' || state === 'failed'
      ? 100
      : typeof job.progress === 'number'
        ? Math.max(0, Math.min(100, Math.round(job.progress)))
        : 0;
  const reasons: string[] = [];
  if (state === 'failed' && job.failedReason) reasons.push(job.failedReason.slice(0, 200));
  if (rv?.reason) reasons.push(rv.reason);
  return {
    runId: job.id,
    source: 'dust',
    state,
    progress,
    startedAt: iso(job.processedOn),
    finishedAt: state === 'completed' || state === 'failed' ? iso(job.finishedOn) : null,
    result:
      state === 'completed'
        ? {
            new: rv?.created ?? 0,
            updated: rv?.updated ?? 0,
            skipped: rv?.skipped ?? 0,
            failed: rv?.errors ?? 0,
          }
        : null,
    reasons,
  };
}

export interface HubspotJobSnapshot {
  status: 'PENDING' | 'RUNNING' | 'COMPLETE' | 'FAILED' | 'CANCELLED';
  totalRows: number;
  processedRows: number;
  errorRows: number;
  startedAt: Date | null;
  completedAt: Date | null;
  errorSummary: unknown;
}

/**
 * Roll the per-entity job statuses up into one run state.
 *
 * A FAILED or CANCELLED entity fails the run only once nothing is still
 * PENDING or RUNNING, so one slow entity does not hide behind another's
 * failure. CANCELLED is reported as failed: the Sync now control has no
 * cancelled state. A RUNNING row with no startedAt is reported queued —
 * status and startedAt can disagree, and the timestamp wins.
 */
export function hubspotAggregateState(
  jobs: ReadonlyArray<Pick<HubspotJobSnapshot, 'status' | 'startedAt'>>,
): SyncRun['state'] {
  const pending = jobs.some((j) => j.status === 'PENDING' || j.status === 'RUNNING');
  let state: SyncRun['state'];
  if (!pending && jobs.some((j) => j.status === 'FAILED' || j.status === 'CANCELLED')) state = 'failed';
  else if (jobs.length > 0 && jobs.every((j) => j.status === 'COMPLETE')) state = 'completed';
  else if (jobs.some((j) => j.startedAt || j.status === 'RUNNING')) state = 'running';
  else state = 'queued';
  if (state === 'running' && jobs.every((j) => !j.startedAt)) state = 'queued';
  return state;
}

/** One HubSpot run spans one MigrationJob per entity type. */
export function hubspotRunFromJobs(
  runId: string,
  jobs: HubspotJobSnapshot[],
  createdCount: number,
): SyncRun {
  const total = jobs.reduce((n, j) => n + j.totalRows, 0);
  const done = jobs.reduce((n, j) => n + j.processedRows + j.errorRows, 0);
  const processed = jobs.reduce((n, j) => n + j.processedRows, 0);
  const failedRows = jobs.reduce((n, j) => n + j.errorRows, 0);

  const state = hubspotAggregateState(jobs);

  const finished = state === 'completed' || state === 'failed';
  const progress = finished ? 100 : total > 0 ? Math.min(99, Math.round((done / total) * 100)) : 0;

  const starts = jobs.flatMap((j) => (j.startedAt ? [j.startedAt.getTime()] : []));
  const ends = jobs.flatMap((j) => (j.completedAt ? [j.completedAt.getTime()] : []));

  const reasons = new Set<string>();
  for (const j of jobs) {
    if (!Array.isArray(j.errorSummary)) continue;
    for (const e of j.errorSummary as Array<{ message?: unknown }>) {
      if (typeof e?.message === 'string') reasons.add(e.message.slice(0, 200));
      if (reasons.size >= MAX_REASONS) break;
    }
  }

  const created = Math.min(createdCount, processed);
  return {
    runId,
    source: 'hubspot',
    state,
    progress,
    startedAt: starts.length ? new Date(Math.min(...starts)).toISOString() : null,
    finishedAt: finished && ends.length ? new Date(Math.max(...ends)).toISOString() : null,
    result: finished
      ? { new: created, updated: processed - created, skipped: 0, failed: failedRows }
      : null,
    reasons: [...reasons],
  };
}

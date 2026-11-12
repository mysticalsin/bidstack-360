/**
 * Runs one DataSubjectRequest row: claims it, resolves the subject, exports or
 * erases, and stores a counts-only report. Called by the data-subject-request
 * worker; integration tests call it directly.
 *
 * Every query carries the request's orgId, so the runner works with
 * BIDSTACK_TENANT_SCOPE_GUARD=enforce.
 *
 * An erasure that unlinks stored objects (uploaded portraits) records their
 * keys on the row as `pendingStorageKeys` before deleting them, and the row
 * only becomes `done` once they are gone. If a delete fails, the row stays
 * `running` and the outcome is `busy`: the worker retries after the claim goes
 * stale, and that run only retries the deletes.
 */
import { DSR_STALE_RUNNING_MS, dsrClaimWhere, dsrOwnedWhere, dsrStateFromStored } from '@bidstack/shared';
import type { Prisma, PrismaClient } from '../../generated/client/index.js';

import {
  eraseDataSubject,
  exportDataSubject,
  resolveDataSubject,
  scanSubjectResidue,
  type DataSubject,
  type DataSubjectType,
} from './data-subject.js';

export interface DataSubjectRequestOutcome {
  id: string;
  /** `busy`: another run holds the claim, or stored objects still need deleting. Retry at `retryAt`. */
  status: 'done' | 'failed' | 'skipped' | 'busy';
  kind: string;
  dryRun: boolean;
  /** For `busy`: when the claim goes stale and the request can be run again. */
  retryAt?: Date;
  /** Failure detail for the caller's log. Not stored on the row: it can echo values. */
  errorDetail?: string;
}

export interface RunDataSubjectRequestOptions {
  /** Delete stored objects by key. A missing object is not an error; throw on any other failure. */
  deleteObjects?: (keys: string[]) => Promise<void>;
  /** Illegal moves are logged with the request id and the states only. */
  log?: { warn: (obj: object, msg?: string) => void };
}

type KnownStatus = 'queued' | 'running' | 'done' | 'failed';

/** Unknown stored text is `failed` for the caller. The row is not rewritten. */
export function storedDataSubjectState(stored: string): KnownStatus {
  return dsrStateFromStored(stored).state;
}

/** A `running` row older than this is treated as abandoned and may be claimed again. */
const STALE_RUNNING_MS = DSR_STALE_RUNNING_MS;

/** Stored on the row and shown to admins; never the raw database message. */
function publicError(err: unknown): string {
  if (err instanceof Error && err.message === 'Subject not found') return 'Subject not found';
  const code = (err as { code?: unknown })?.code;
  return typeof code === 'string' ? `Request failed (${code})` : 'Request failed';
}

function pendingStorageKeys(report: unknown): string[] | null {
  const keys = (report as { pendingStorageKeys?: unknown } | null)?.pendingStorageKeys;
  return Array.isArray(keys) ? keys.filter((k): k is string => typeof k === 'string') : null;
}

export async function runDataSubjectRequest(
  db: PrismaClient,
  requestId: string,
  orgId: string,
  opts: RunDataSubjectRequestOptions = {},
): Promise<DataSubjectRequestOutcome> {
  // startedAt is this run's claim token. A stale reclaim writes a new one, so
  // this run's later updates no longer match.
  const claimedAt = new Date();
  const claimed = await db.dataSubjectRequest.updateMany({
    where: dsrClaimWhere(requestId, orgId, claimedAt),
    data: { status: 'running', startedAt: claimedAt },
  });
  const row = await db.dataSubjectRequest.findFirst({ where: { id: requestId, orgId } });
  if (!row) throw new Error(`data-subject-request ${requestId} not found`);
  const outcome = { id: row.id, kind: row.kind, dryRun: row.dryRun };
  const retryAt = () => new Date((row.startedAt?.getTime() ?? Date.now()) + STALE_RUNNING_MS + 1_000);
  if (!dsrStateFromStored(row.status).known) {
    // Safe state is failed: queued would run another erasure, done would hide one.
    opts.log?.warn(
      { requestId: row.id, from: row.status, to: 'failed' },
      'illegal data subject transition',
    );
    return { ...outcome, status: 'failed' };
  }
  if (claimed.count === 0) {
    // A recent run still holds the claim; acknowledging the job here would
    // strand the row if that run died.
    if (row.status === 'running') return { ...outcome, status: 'busy', retryAt: retryAt() };
    return { ...outcome, status: 'skipped' };
  }

  /** Someone else holds the row. Report what is stored. Do not write. */
  const lostClaim = async (to: 'done' | 'failed'): Promise<DataSubjectRequestOutcome> => {
    const current = await db.dataSubjectRequest.findFirst({
      where: { id: row.id, orgId: row.orgId },
      select: { status: true },
    });
    const state = storedDataSubjectState(current?.status ?? '');
    opts.log?.warn(
      { requestId: row.id, from: current?.status ?? null, to },
      'illegal data subject transition',
    );
    if (state === 'running') return { ...outcome, status: 'busy', retryAt: retryAt() };
    if (state === 'done') return { ...outcome, status: 'done' };
    if (state === 'queued') return { ...outcome, status: 'skipped' };
    return { ...outcome, status: 'failed' };
  };

  /** `done` and `failed` are written only from this run's claim. Null means this run won. */
  const writeFromRunning = async (
    status: 'done' | 'failed',
    data: Prisma.DataSubjectRequestUpdateManyMutationInput,
  ): Promise<DataSubjectRequestOutcome | null> => {
    const moved = await db.dataSubjectRequest.updateMany({
      where: dsrOwnedWhere(row.id, row.orgId, claimedAt, 'running'),
      data: { ...data, status },
    });
    if (moved.count === 1) return null;
    return lostClaim(status);
  };

  /** Delete stored objects, then mark the erasure done. `busy` when a delete failed. */
  const completeErase = async (
    base: Prisma.InputJsonObject,
    keys: string[],
    subject: DataSubject | null,
  ): Promise<DataSubjectRequestOutcome> => {
    if (keys.length) {
      try {
        if (!opts.deleteObjects) throw new Error('no object store configured');
        await opts.deleteObjects(keys);
      } catch (err) {
        return {
          ...outcome,
          status: 'busy',
          retryAt: retryAt(),
          errorDetail: `stored object delete failed: ${err instanceof Error ? err.message.slice(0, 200) : 'unknown'}`,
        };
      }
    }
    // The erasure has committed: record it as done before the residue scan,
    // so a scan failure can never make a completed erasure look failed.
    // Only a row that is still running may become done.
    const lost = await writeFromRunning('done', { report: base, error: null, completedAt: new Date() });
    if (lost) return lost;
    if (!row.dryRun && subject) {
      let extra: Prisma.InputJsonObject;
      try {
        extra = { residue: (await scanSubjectResidue(db, subject)) as unknown as Prisma.InputJsonArray };
      } catch (err) {
        extra = { residueError: publicError(err) };
      }
      await db.dataSubjectRequest.updateMany({
        where: dsrOwnedWhere(row.id, row.orgId, claimedAt, 'done'),
        data: { report: { ...base, ...extra } },
      });
    }
    return { ...outcome, status: 'done' };
  };

  try {
    const subject = await resolveDataSubject(
      db,
      row.orgId,
      row.subjectType as DataSubjectType,
      row.subjectId,
    );

    const pending = row.kind === 'erase' ? pendingStorageKeys(row.report) : null;
    if (pending) {
      // An earlier run committed the erasure; only its object deletes are left.
      const { pendingStorageKeys: _keys, ...base } = row.report as Prisma.JsonObject;
      return await completeErase(base as Prisma.InputJsonObject, pending, subject);
    }
    if (!subject) throw new Error('Subject not found');

    if (row.kind === 'erase') {
      const { storageKeys, ...erased } = await eraseDataSubject(db, subject, {
        dryRun: row.dryRun,
        actorUserId: row.requestedById,
        requestId: row.id,
      });
      const base = erased as unknown as Prisma.InputJsonObject;
      if (storageKeys.length) {
        const noted = await db.dataSubjectRequest.updateMany({
          where: dsrOwnedWhere(row.id, row.orgId, claimedAt, 'running'),
          data: { report: { ...base, pendingStorageKeys: storageKeys } },
        });
        if (noted.count !== 1) return lostClaim('done');
      }
      return await completeErase(base, storageKeys, subject);
    }

    const bundle = await exportDataSubject(db, subject);
    const stores = Object.fromEntries(
      Object.entries(bundle.stores).map(([model, rows]) => [
        model,
        { action: 'export', rows: rows.length },
      ]),
    );
    const report: Prisma.InputJsonObject = {
      kind: 'export',
      dryRun: row.dryRun,
      subjectType: subject.subjectType,
      subjectId: subject.subjectId,
      scrubbedFields: [],
      stores,
      retained: {},
      auditRowsPseudonymised: 0,
    };
    await db.auditLog.create({
      data: {
        orgId: row.orgId,
        userId: row.requestedById,
        action: 'gdpr.export',
        targetType: row.subjectType,
        targetId: row.subjectId,
        diff: { requestId: row.id, dryRun: row.dryRun, stores: Object.keys(stores) },
      },
    });
    const lost = await writeFromRunning('done', { report, error: null, completedAt: new Date() });
    if (lost) return lost;
    return { ...outcome, status: 'done' };
  } catch (err) {
    const lost = await writeFromRunning('failed', { error: publicError(err), completedAt: new Date() });
    if (lost) return lost;
    return {
      ...outcome,
      status: 'failed',
      errorDetail: err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500),
    };
  }
}

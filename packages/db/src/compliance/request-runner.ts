/**
 * Runs one DataSubjectRequest row: claims it, resolves the subject, exports or
 * erases, and stores a counts-only report. Called by the data-subject-request
 * worker; integration tests call it directly.
 */
import type { Prisma, PrismaClient } from '../../generated/client/index.js';

import {
  eraseDataSubject,
  exportDataSubject,
  resolveDataSubject,
  scanSubjectResidue,
  type DataSubjectType,
} from './data-subject.js';

export interface DataSubjectRequestOutcome {
  id: string;
  status: 'done' | 'failed' | 'skipped';
  kind: string;
  dryRun: boolean;
  /** Failure detail for the caller's log. Not stored on the row: it can echo values. */
  errorDetail?: string;
}

/** A `running` row older than this is treated as abandoned and may be claimed again. */
const STALE_RUNNING_MS = 15 * 60_000;

/** Stored on the row and shown to admins; never the raw database message. */
function publicError(err: unknown): string {
  if (err instanceof Error && err.message === 'Subject not found') return 'Subject not found';
  const code = (err as { code?: unknown })?.code;
  return typeof code === 'string' ? `Request failed (${code})` : 'Request failed';
}

export async function runDataSubjectRequest(
  db: PrismaClient,
  requestId: string,
): Promise<DataSubjectRequestOutcome> {
  const claimed = await db.dataSubjectRequest.updateMany({
    where: {
      id: requestId,
      OR: [
        { status: 'queued' },
        { status: 'running', startedAt: { lt: new Date(Date.now() - STALE_RUNNING_MS) } },
      ],
    },
    data: { status: 'running', startedAt: new Date() },
  });
  const row = await db.dataSubjectRequest.findUnique({ where: { id: requestId } });
  if (!row) throw new Error(`data-subject-request ${requestId} not found`);
  if (claimed.count === 0)
    return { id: row.id, status: 'skipped', kind: row.kind, dryRun: row.dryRun };

  try {
    const subject = await resolveDataSubject(
      db,
      row.orgId,
      row.subjectType as DataSubjectType,
      row.subjectId,
    );
    if (!subject) throw new Error('Subject not found');

    if (row.kind === 'erase') {
      const erased = await eraseDataSubject(db, subject, {
        dryRun: row.dryRun,
        actorUserId: row.requestedById,
        requestId: row.id,
      });
      // The erasure has committed: record it as done before the residue scan,
      // so a scan failure can never make a completed erasure look failed.
      const base = erased as unknown as Prisma.InputJsonObject;
      await db.dataSubjectRequest.update({
        where: { id: row.id },
        data: { status: 'done', report: base, error: null, completedAt: new Date() },
      });
      if (!row.dryRun) {
        let extra: Prisma.InputJsonObject;
        try {
          extra = { residue: (await scanSubjectResidue(db, subject)) as unknown as Prisma.InputJsonArray };
        } catch (err) {
          extra = { residueError: publicError(err) };
        }
        await db.dataSubjectRequest.update({
          where: { id: row.id },
          data: { report: { ...base, ...extra } },
        });
      }
      return { id: row.id, status: 'done', kind: row.kind, dryRun: row.dryRun };
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
    await db.dataSubjectRequest.update({
      where: { id: row.id },
      data: { status: 'done', report, error: null, completedAt: new Date() },
    });
    return { id: row.id, status: 'done', kind: row.kind, dryRun: row.dryRun };
  } catch (err) {
    await db.dataSubjectRequest.update({
      where: { id: row.id },
      data: { status: 'failed', error: publicError(err), completedAt: new Date() },
    });
    return {
      id: row.id,
      status: 'failed',
      kind: row.kind,
      dryRun: row.dryRun,
      errorDetail: err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500),
    };
  }
}

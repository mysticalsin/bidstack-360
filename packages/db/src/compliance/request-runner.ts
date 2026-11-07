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
}

export async function runDataSubjectRequest(
  db: PrismaClient,
  requestId: string,
): Promise<DataSubjectRequestOutcome> {
  const claimed = await db.dataSubjectRequest.updateMany({
    where: { id: requestId, status: { in: ['queued', 'running'] } },
    data: { status: 'running', startedAt: new Date() },
  });
  const row = await db.dataSubjectRequest.findUnique({ where: { id: requestId } });
  if (!row) throw new Error(`data-subject-request ${requestId} not found`);
  if (claimed.count === 0) return { id: row.id, status: 'skipped', kind: row.kind, dryRun: row.dryRun };

  try {
    const subject = await resolveDataSubject(
      db,
      row.orgId,
      row.subjectType as DataSubjectType,
      row.subjectId,
    );
    if (!subject) throw new Error('Subject not found');

    let report: Prisma.InputJsonObject;
    if (row.kind === 'erase') {
      const erased = await eraseDataSubject(db, subject, {
        dryRun: row.dryRun,
        actorUserId: row.requestedById,
        requestId: row.id,
      });
      const residue = row.dryRun ? [] : await scanSubjectResidue(db, subject);
      report = { ...erased, residue } as unknown as Prisma.InputJsonObject;
    } else {
      const bundle = await exportDataSubject(db, subject);
      const stores = Object.fromEntries(
        Object.entries(bundle.stores).map(([model, rows]) => [model, { action: 'export', rows: rows.length }]),
      );
      report = {
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
    }

    await db.dataSubjectRequest.update({
      where: { id: row.id },
      data: { status: 'done', report, error: null, completedAt: new Date() },
    });
    return { id: row.id, status: 'done', kind: row.kind, dryRun: row.dryRun };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'data subject request failed';
    await db.dataSubjectRequest.update({
      where: { id: row.id },
      data: { status: 'failed', error: message.slice(0, 2000), completedAt: new Date() },
    });
    return { id: row.id, status: 'failed', kind: row.kind, dryRun: row.dryRun };
  }
}

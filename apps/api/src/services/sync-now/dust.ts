import { prisma } from '@bidstack/db';
import type { SyncOverview, SyncRun } from '@bidstack/shared';

import { enqueueDustSyncRun, getDustPollJob } from '../../queues/dust-poll.js';
import { dustRunFromJob, syncRunId } from './runs.js';
import { SyncNotFoundError, type StartSyncInput } from './errors.js';

async function snapshot(runId: string, orgId: string): Promise<SyncRun | null> {
  const job = await getDustPollJob(runId);
  if (!job || (job.data as { orgId?: string } | undefined)?.orgId !== orgId) return null;
  return dustRunFromJob({
    id: job.id ?? runId,
    state: await job.getState(),
    progress: job.progress,
    timestamp: job.timestamp,
    processedOn: job.processedOn,
    finishedOn: job.finishedOn,
    returnvalue: job.returnvalue,
    failedReason: job.failedReason,
  });
}

export async function startDustSync(input: StartSyncInput): Promise<SyncRun> {
  const runId = syncRunId(input.orgId, 'dust', input.idempotencyKey);
  await enqueueDustSyncRun(input.orgId, runId);
  await prisma.auditLog.create({
    data: {
      orgId: input.orgId,
      userId: input.userId.startsWith('apikey:') ? null : input.userId,
      action: 'sync_now.start',
      targetType: 'sync_run',
      targetId: runId,
      diff: { source: 'dust' },
    },
  });
  const run = await snapshot(runId, input.orgId);
  if (!run) throw new SyncNotFoundError();
  return run;
}

export async function getDustSyncRun(orgId: string, runId: string): Promise<SyncRun> {
  if (!runId.startsWith('dust-')) throw new SyncNotFoundError();
  const run = await snapshot(runId, orgId);
  if (!run) throw new SyncNotFoundError();
  return run;
}

export async function getDustSyncOverview(orgId: string): Promise<SyncOverview> {
  const [last, lastStart] = await Promise.all([
    prisma.syncEvent.findFirst({
      where: { orgId, source: 'dust.poll', eventType: 'poll.completed' },
      orderBy: { receivedAt: 'desc' },
      select: { processedAt: true, receivedAt: true },
    }),
    prisma.auditLog.findFirst({
      where: {
        orgId,
        action: 'sync_now.start',
        targetType: 'sync_run',
        diff: { path: ['source'], equals: 'dust' },
      },
      orderBy: { at: 'desc' },
      select: { targetId: true },
    }),
  ]);
  const lastRun = lastStart?.targetId ? await snapshot(lastStart.targetId, orgId) : null;
  return {
    source: 'dust',
    lastSyncedAt: (last?.processedAt ?? last?.receivedAt)?.toISOString() ?? null,
    lastRun,
  };
}

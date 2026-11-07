import { Queue } from 'bullmq';
import IORedis from 'ioredis';

import { prisma } from '@bidstack/db';
import { MIGRATION, type SyncOverview, type SyncRun } from '@bidstack/shared';

import {
  HUBSPOT_IMPORT_ENTITIES,
  HubspotNotConnectedError,
  startHubspotImport,
} from '../hubspot-import.js';
import { SyncNotFoundError, SyncUnavailableError, type StartSyncInput } from './errors.js';
import { hubspotRunFromJobs, syncRunId } from './runs.js';

let queueSingleton: Queue | null = null;

function migrationQueue(): Queue {
  if (queueSingleton) return queueSingleton;
  const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6380', {
    maxRetriesPerRequest: null,
  });
  queueSingleton = new Queue(MIGRATION.name, {
    connection,
    defaultJobOptions: MIGRATION.defaultJobOptions as never,
  });
  return queueSingleton;
}

const runJobsWhere = (orgId: string, runId: string) => ({
  orgId,
  source: 'HUBSPOT_OAUTH' as const,
  meta: { path: ['syncRunId'], equals: runId },
});

async function snapshot(orgId: string, runId: string): Promise<SyncRun | null> {
  const jobs = await prisma.migrationJob.findMany({
    where: runJobsWhere(orgId, runId),
    select: {
      id: true,
      status: true,
      totalRows: true,
      processedRows: true,
      errorRows: true,
      startedAt: true,
      completedAt: true,
      errorSummary: true,
    },
  });
  if (jobs.length === 0) return null;
  const chunks = await prisma.auditLog.findMany({
    where: {
      orgId,
      action: 'migration.chunk.imported',
      targetType: 'MigrationJob',
      targetId: { in: jobs.map((j) => j.id) },
    },
    select: { diff: true },
  });
  const created = chunks.reduce((n, c) => {
    const ids = (c.diff as { createdIds?: unknown } | null)?.createdIds;
    return n + (Array.isArray(ids) ? ids.length : 0);
  }, 0);
  return hubspotRunFromJobs(runId, jobs, created);
}

export async function startHubspotSync(input: StartSyncInput): Promise<SyncRun> {
  const runId = syncRunId(input.orgId, 'hubspot', input.idempotencyKey);
  const existing = await snapshot(input.orgId, runId);
  if (existing) return existing;
  try {
    await startHubspotImport({
      orgId: input.orgId,
      userId: input.userId,
      entities: HUBSPOT_IMPORT_ENTITIES,
      dedupStrategy: 'update',
      queue: migrationQueue(),
      syncRunId: runId,
    });
  } catch (err) {
    if (err instanceof HubspotNotConnectedError) throw new SyncUnavailableError(err.message);
    throw err;
  }
  const run = await snapshot(input.orgId, runId);
  if (!run) throw new SyncNotFoundError();
  return run;
}

export async function getHubspotSyncRun(orgId: string, runId: string): Promise<SyncRun> {
  if (!runId.startsWith('hubspot-')) throw new SyncNotFoundError();
  const run = await snapshot(orgId, runId);
  if (!run) throw new SyncNotFoundError();
  return run;
}

export async function getHubspotSyncOverview(orgId: string): Promise<SyncOverview> {
  const [lastComplete, lastRunJob] = await Promise.all([
    prisma.migrationJob.findFirst({
      where: { orgId, source: 'HUBSPOT_OAUTH', status: 'COMPLETE', completedAt: { not: null } },
      orderBy: { completedAt: 'desc' },
      select: { completedAt: true },
    }),
    prisma.migrationJob.findFirst({
      where: {
        orgId,
        source: 'HUBSPOT_OAUTH',
        meta: { path: ['syncRunId'], string_starts_with: 'hubspot-' },
      },
      orderBy: { createdAt: 'desc' },
      select: { meta: true },
    }),
  ]);
  const lastRunId = (lastRunJob?.meta as { syncRunId?: unknown } | null)?.syncRunId;
  return {
    source: 'hubspot',
    lastSyncedAt: lastComplete?.completedAt?.toISOString() ?? null,
    lastRun: typeof lastRunId === 'string' ? await snapshot(orgId, lastRunId) : null,
  };
}

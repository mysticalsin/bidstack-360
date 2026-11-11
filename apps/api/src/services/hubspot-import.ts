// Start a HubSpot import: one MigrationJob plus a first BullMQ chunk per entity
// type. Shared by POST /api/v1/migrations/start-hubspot and the HubSpot
// "Sync now" control, so both paths create identical jobs and audit rows.

import { randomUUID } from 'node:crypto';

import type { Queue } from 'bullmq';
import type { z } from 'zod';

import { prisma } from '@bidstack/db';
import {
  DedupStrategyEnum,
  HUBSPOT_COMPANY_DEFAULTS,
  HUBSPOT_CONTACT_DEFAULTS,
  HUBSPOT_DEAL_DEFAULTS,
  MigrationJobPayload,
} from '@bidstack/shared';

import { assertSerumConnectorAllowed } from '../lib/serum-connector-policy.js';
import { discardFailedStart } from '../lib/failed-start-cleanup.js';
import { addWithinDeadline } from '../lib/queue-enqueue.js';
import { withUploadLock } from '../lib/upload-start.js';
import { isUniqueViolation } from '../routes/opportunities.helpers.js';

export const HUBSPOT_IMPORT_ENTITIES = ['companies', 'contacts', 'deals', 'tasks'] as const;
export type HubspotImportEntity = (typeof HUBSPOT_IMPORT_ENTITIES)[number];
/** What Sync now imports: the migration worker has no task mapping and fails a
 *  tasks job, which would mark the whole run failed. */
export const HUBSPOT_SYNC_ENTITIES = ['companies', 'contacts', 'deals'] as const satisfies readonly HubspotImportEntity[];

const HUBSPOT_INTEGRATION_TYPE = 'hubspot';
const HUBSPOT_MIGRATION_CONFIG_NAME = 'hubspot-migration';

export class HubspotNotConnectedError extends Error {
  constructor() {
    super('HubSpot not connected. Complete the OAuth flow first.');
    this.name = 'HubspotNotConnectedError';
  }
}

export function buildHubSpotMigrationPayload(input: {
  migrationJobId: string;
  orgId: string;
  userId: string;
  entityType: string;
  totalRows: number;
  mappings: Record<string, string | null>;
  dedupStrategy: z.infer<typeof DedupStrategyEnum>;
  hubspotIntegrationConfigId: string;
}): MigrationJobPayload {
  return MigrationJobPayload.parse({
    migrationJobId: input.migrationJobId,
    orgId: input.orgId,
    userId: input.userId,
    source: 'HUBSPOT_OAUTH',
    entityType: input.entityType,
    chunkOffset: 0,
    chunkSize: 100,
    totalRows: input.totalRows,
    mappings: input.mappings,
    dedupStrategy: input.dedupStrategy,
    externalIdColumn: 'hs_object_id',
    meta: { hubspotIntegrationConfigId: input.hubspotIntegrationConfigId },
  });
}

export async function findHubspotConnection(orgId: string) {
  return prisma.integrationConfig.findFirst({
    where: {
      orgId,
      type: HUBSPOT_INTEGRATION_TYPE,
      name: HUBSPOT_MIGRATION_CONFIG_NAME,
      isActive: true,
    },
    select: { id: true, config: true },
  });
}

export class UploadIdConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UploadIdConflictError';
  }
}

type MigrationJobRow = Awaited<ReturnType<typeof prisma.migrationJob.create>>;

export async function startHubspotImport(input: {
  orgId: string;
  userId: string;
  entities: readonly HubspotImportEntity[];
  dedupStrategy: z.infer<typeof DedupStrategyEnum>;
  queue: Queue;
  /** Set by Sync now so the run can be polled across its MigrationJobs. */
  syncRunId?: string;
  /** The client's key for this start: a retry with the same key resumes or
   *  returns the start it made instead of importing again. */
  uploadId?: string;
  /** Receives cleanup failures of a start that could not be queued. */
  log?: { error(obj: object, msg: string): void };
}) {
  const { orgId, userId, uploadId } = input;

  // Workers resolve encrypted tokens just in time so raw OAuth tokens are
  // never persisted in BullMQ payloads.
  const config = await findHubspotConnection(orgId);
  if (!config) throw new HubspotNotConnectedError();

  await assertSerumConnectorAllowed({
    orgId,
    connectorId: 'hubspot',
    operation: 'hubspot.import.start',
    writeRequested: false,
  });

  const entityMappings: Record<string, Record<string, string | null>> = {
    companies: HUBSPOT_COMPANY_DEFAULTS,
    contacts: HUBSPOT_CONTACT_DEFAULTS,
    deals: HUBSPOT_DEAL_DEFAULTS,
    tasks: {},
  };

  const discovery = (config.config as Record<string, unknown>).discovery as Record<string, number>;
  type Planned = { entity: HubspotImportEntity; totalRows: number; job: MigrationJobRow };

  // One MULTI: every given entity is queued, or none is. The chunk ids are
  // derived from the job ids, so queueing a job's first chunk again adds
  // nothing while BullMQ still holds it.
  const queueFirstChunks = (planned: readonly Planned[]) =>
    addWithinDeadline(input.queue, (q) =>
      q.addBulk(
        planned.map(({ entity, totalRows, job }) => ({
          // The worker paginates via the hubspotAfter cursor from this first chunk.
          name: `${job.id}-chunk-0`,
          data: buildHubSpotMigrationPayload({
            migrationJobId: job.id,
            orgId,
            userId,
            entityType: entity,
            totalRows,
            mappings: entityMappings[entity] ?? {},
            dedupStrategy: input.dedupStrategy,
            hubspotIntegrationConfigId: config.id,
          }),
          opts: { jobId: `${job.id}-${entity}-chunk-0` },
        })),
      ),
    );

  const resume = async (earlier: MigrationJobRow[]) => {
    const planned = earlier.map((job) => ({
      entity: (job.meta as { entityType?: unknown } | null)?.entityType as HubspotImportEntity,
      totalRows: job.totalRows,
      job,
    }));
    const sameEntities = [...planned.map((p) => p.entity)].sort().join() === [...input.entities].sort().join();
    if (earlier.some((job) => job.source !== 'HUBSPOT_OAUTH') || !sameEntities) {
      throw new UploadIdConflictError('uploadId was already used for a different upload');
    }
    // The audit row is a job's last start write, so a job without one is a
    // start that failed after queueing. Its first chunk is queued again unless
    // the worker already finished or failed the job.
    const audited = await prisma.auditLog.findMany({
      where: { orgId, action: 'migration.start', targetId: { in: earlier.map((job) => job.id) } },
      select: { targetId: true },
      take: earlier.length,
    });
    const done = new Set(audited.map((a) => a.targetId));
    const unfinished = planned.filter((p) => !done.has(p.job.id));
    const requeue = unfinished.filter((p) => p.job.status === 'RUNNING');
    if (requeue.length > 0) await queueFirstChunks(requeue);
    await finishStart(unfinished);
    return earlier;
  };

  const start = async () => {
    if (uploadId) {
      const earlier = await prisma.migrationJob.findMany({
        where: { orgId, meta: { path: ['uploadId'], equals: uploadId } },
        orderBy: { createdAt: 'asc' },
        // One row more than this request would create is enough to tell another start apart.
        take: input.entities.length + 1,
      });
      if (earlier.length > 0) return resume(earlier);
    }

    // One insert, so a start's jobs exist all together or not at all. The
    // first job holds the uploadId column (one start per key and org); every
    // job records the key in meta so a retry finds them all.
    const drafts = input.entities.map((entity) => ({ id: randomUUID(), entity, totalRows: discovery?.[entity] ?? 0 }));
    const startedAt = new Date();
    try {
      await prisma.migrationJob.createMany({
        data: drafts.map(({ id, entity, totalRows }, i) => ({
          id,
          orgId,
          userId,
          source: 'HUBSPOT_OAUTH' as const,
          status: 'RUNNING' as const,
          startedAt,
          totalRows,
          uploadId: i === 0 ? uploadId : undefined,
          meta: {
            entityType: entity,
            ...(input.syncRunId ? { syncRunId: input.syncRunId } : {}),
            ...(uploadId ? { uploadId } : {}),
          },
        })),
      });
    } catch (err) {
      if (uploadId && isUniqueViolation(err)) {
        throw new UploadIdConflictError('A start with this uploadId already exists; retry to resume it');
      }
      throw err;
    }
    const rows = new Map(
      (await prisma.migrationJob.findMany({ where: { id: { in: drafts.map((d) => d.id) } }, take: drafts.length })).map((job) => [job.id, job]),
    );
    const planned: Planned[] = drafts.map(({ id, entity, totalRows }) => ({ entity, totalRows, job: rows.get(id)! }));

    // All entities queue together or not at all, so a failed start never
    // leaves some entities importing while the caller (and the client's
    // retry) sees an error. On failure the job rows are removed; the audit
    // log is append-only, so it is written only once the import is queued.
    // A chunk that lands after the deadline finds no job row and the worker
    // skips it.
    try {
      await queueFirstChunks(planned);
    } catch (err) {
      await discardFailedStart(err, input.log ?? { error: () => {} }, [
        ['delete job rows', () => prisma.migrationJob.deleteMany({ where: { id: { in: planned.map((p) => p.job.id) } } })],
      ]);
      throw err;
    }
    await finishStart(planned);
    return planned.map((p) => p.job);
  };

  async function finishStart(planned: readonly Planned[]) {
    for (const { entity, totalRows, job } of planned) {
      await prisma.migrationMapping.upsert({
        where: {
          orgId_source_sourceEntity: { orgId, source: 'HUBSPOT_OAUTH', sourceEntity: entity },
        },
        create: {
          orgId,
          source: 'HUBSPOT_OAUTH',
          sourceEntity: entity,
          mappings: entityMappings[entity] ?? {},
        },
        update: { mappings: entityMappings[entity] ?? {} },
      });

      await prisma.auditLog.create({
        data: {
          orgId,
          userId,
          action: 'migration.start',
          targetType: 'MigrationJob',
          targetId: job.id,
          diff: input.syncRunId
            ? { source: 'HUBSPOT_OAUTH', entityType: entity, totalRows, syncRunId: input.syncRunId }
            : { source: 'HUBSPOT_OAUTH', entityType: entity, totalRows },
        },
      });
    }
  }

  return uploadId ? withUploadLock(orgId, uploadId, start) : start();
}

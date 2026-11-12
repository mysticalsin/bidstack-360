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
  MIGRATION_ENQUEUE_FAILED,
  migrationFrom,
} from '@bidstack/shared';

import { assertSerumConnectorAllowed } from '../lib/serum-connector-policy.js';

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
  attemptId?: string;
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
    ...(input.attemptId ? { attemptId: input.attemptId } : {}),
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

const HUBSPOT_ENTITY_MAPPINGS: Record<string, Record<string, string | null>> = {
  companies: HUBSPOT_COMPANY_DEFAULTS,
  contacts: HUBSPOT_CONTACT_DEFAULTS,
  deals: HUBSPOT_DEAL_DEFAULTS,
  tasks: {},
};

/** Enqueue the first HubSpot chunk for a job that is already RUNNING. */
export async function enqueueHubspotChunk(input: {
  jobId: string;
  orgId: string;
  userId: string;
  entityType: string;
  totalRows: number;
  dedupStrategy: z.infer<typeof DedupStrategyEnum>;
  attemptId: string;
  queue: Queue;
}): Promise<void> {
  const config = await findHubspotConnection(input.orgId);
  if (!config) throw new HubspotNotConnectedError();
  const payload = buildHubSpotMigrationPayload({
    migrationJobId: input.jobId,
    orgId: input.orgId,
    userId: input.userId,
    entityType: input.entityType,
    totalRows: input.totalRows,
    mappings: HUBSPOT_ENTITY_MAPPINGS[input.entityType] ?? {},
    dedupStrategy: input.dedupStrategy,
    hubspotIntegrationConfigId: config.id,
    attemptId: input.attemptId,
  });
  await input.queue.add(`${input.jobId}-chunk-0`, payload, {
    jobId: `${input.jobId}-${input.entityType}-chunk-${Date.now()}`,
  });
}

export async function startHubspotImport(input: {
  orgId: string;
  userId: string;
  entities: readonly HubspotImportEntity[];
  dedupStrategy: z.infer<typeof DedupStrategyEnum>;
  queue: Queue;
  /** Set by Sync now so the run can be polled across its MigrationJobs. */
  syncRunId?: string;
}) {
  const { orgId, userId } = input;

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

  const jobs: Awaited<ReturnType<typeof prisma.migrationJob.create>>[] = [];

  for (const entity of input.entities) {
    const discovery = (config.config as Record<string, unknown>).discovery as Record<
      string,
      number
    >;
    const totalRows = discovery?.[entity] ?? 0;

    const attemptId = randomUUID();
    const job = await prisma.migrationJob.create({
      data: {
        orgId,
        userId,
        source: 'HUBSPOT_OAUTH',
        status: 'RUNNING',
        startedAt: new Date(),
        totalRows,
        meta: input.syncRunId
          ? { entityType: entity, dedupStrategy: input.dedupStrategy, syncRunId: input.syncRunId, attemptId }
          : { entityType: entity, dedupStrategy: input.dedupStrategy, attemptId },
      },
    });

    await prisma.migrationMapping.upsert({
      where: {
        orgId_source_sourceEntity: { orgId, source: 'HUBSPOT_OAUTH', sourceEntity: entity },
      },
      create: {
        orgId,
        source: 'HUBSPOT_OAUTH',
        sourceEntity: entity,
        mappings: HUBSPOT_ENTITY_MAPPINGS[entity] ?? {},
      },
      update: { mappings: HUBSPOT_ENTITY_MAPPINGS[entity] ?? {} },
    });

    // Enqueue first chunk; the worker paginates via the hubspotAfter cursor.
    let enqueued = true;
    try {
      await enqueueHubspotChunk({
        jobId: job.id,
        orgId,
        userId,
        entityType: entity,
        totalRows,
        dedupStrategy: input.dedupStrategy,
        attemptId,
        queue: input.queue,
      });
    } catch {
      enqueued = false;
      // The job is already RUNNING. Leave it FAILED and return it, so the
      // caller can show the failure instead of a 500 with a stranded row.
      await prisma.migrationJob.updateMany({
        where: { id: job.id, orgId, status: { in: [...migrationFrom('fail')] } },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          errorSummary: [{ row: 0, field: null, message: MIGRATION_ENQUEUE_FAILED }],
        },
      });
    }

    if (enqueued) {
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
    jobs.push(
      await prisma.migrationJob.findFirstOrThrow({ where: { id: job.id, orgId } }),
    );
  }

  return jobs;
}

// Start a HubSpot import: one MigrationJob plus a first BullMQ chunk per entity
// type. Shared by POST /api/v1/migrations/start-hubspot and the HubSpot
// "Sync now" control, so both paths create identical jobs and audit rows.

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
import { addWithinDeadline } from '../lib/queue-enqueue.js';

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

  const entityMappings: Record<string, Record<string, string | null>> = {
    companies: HUBSPOT_COMPANY_DEFAULTS,
    contacts: HUBSPOT_CONTACT_DEFAULTS,
    deals: HUBSPOT_DEAL_DEFAULTS,
    tasks: {},
  };

  const discovery = (config.config as Record<string, unknown>).discovery as Record<string, number>;
  const planned: Array<{
    entity: HubspotImportEntity;
    totalRows: number;
    job: Awaited<ReturnType<typeof prisma.migrationJob.create>>;
  }> = [];
  for (const entity of input.entities) {
    const totalRows = discovery?.[entity] ?? 0;
    const job = await prisma.migrationJob.create({
      data: {
        orgId,
        userId,
        source: 'HUBSPOT_OAUTH',
        status: 'RUNNING',
        startedAt: new Date(),
        totalRows,
        meta: input.syncRunId
          ? { entityType: entity, syncRunId: input.syncRunId }
          : { entityType: entity },
      },
    });
    planned.push({ entity, totalRows, job });
  }

  // All entities queue together or not at all: addBulk is one MULTI, so a
  // failed start never leaves some entities importing while the caller (and
  // the client's retry) sees an error. On failure the job rows are removed;
  // the audit log is append-only, so it is written only once the import is
  // queued. A chunk that lands after the deadline finds no job row and the
  // worker skips it.
  try {
    await addWithinDeadline(input.queue, (q) =>
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
  } catch (err) {
    await prisma.migrationJob.deleteMany({ where: { id: { in: planned.map((p) => p.job.id) } } });
    throw err;
  }

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

  return planned.map((p) => p.job);
}

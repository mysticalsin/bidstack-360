// Repeating BullMQ job that pulls deltas from Dust every 5 minutes.
// When DUST_API_KEY is configured, documents are mapped to CRM entities
// based on metadata/tags. Otherwise stub sync_events are written for UI
// feedback.

import { Queue, Worker } from 'bullmq';
import type IORedis from 'ioredis';
import type pino from 'pino';
import { z } from 'zod';

import { prisma } from '@bidstack/db';
import { DustClient } from '@bidstack/dust-client';
import { DUST_POLL } from '@bidstack/shared';
import {
  upsertOpportunityFromDust,
  upsertCompanyFromDust,
  upsertNoteFromDust,
  upsertLeadFromDust,
} from './dust-sync-helpers.js';

const QUEUE_NAME = DUST_POLL.name;
const REPEAT_EVERY_MS = 5 * 60 * 1000;

const JobData = z.object({
  source: z.string(),
  orgId: z.string().uuid().optional(),
});

// Circuit breaker state
let consecutiveFailures = 0;
const CIRCUIT_THRESHOLD = 3;
const CIRCUIT_COOLDOWN_MS = 10 * 60 * 1000; // 10 min
let circuitOpenUntil = 0;

export async function startDustPoller(
  connection: IORedis,
  log: pino.Logger,
  workers: Worker[],
  queues: Queue[],
): Promise<void> {
  const queue = new Queue(QUEUE_NAME, {
    connection,
    defaultJobOptions: DUST_POLL.defaultJobOptions,
  });
  queues.push(queue);

  await queue.add(
    'dust.poll',
    { source: 'scheduled' },
    {
      repeat: { every: REPEAT_EVERY_MS },
      removeOnComplete: { age: 3600, count: 100 },
      removeOnFail: { age: 86400 },
    },
  );

  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const data = JobData.parse(job.data);
      log.info({ jobId: job.id, name: job.name, source: data.source }, 'dust.poll tick');

      // Circuit breaker check
      if (Date.now() < circuitOpenUntil) {
        log.warn('circuit open, skipping dust poll');
        return;
      }

      const apiKey = process.env.DUST_API_KEY;
      const workspaceId = process.env.DUST_WORKSPACE_ID;
      const dataSourceId = process.env.DUST_DATA_SOURCE_ID;

      // No keys => stub: log to sync_events for every seeded org so the
      // integration UI has feedback during dev.
      if (!apiKey || !workspaceId || !dataSourceId) {
        const orgs = await prisma.org.findMany({ select: { id: true } });
        await prisma.syncEvent.createMany({
          data: orgs.map((o) => ({
            orgId: o.id,
            source: 'dust.poll',
            eventType: 'tick.stub',
            payload: { reason: 'DUST_API_KEY/DUST_WORKSPACE_ID/DUST_DATA_SOURCE_ID not set' },
            status: 'processed' as const,
            processedAt: new Date(),
          })),
        });
        return;
      }

      try {
        const dust = new DustClient({ apiKey, workspaceId, logger: log.child({ kind: 'dust' }) });
        const docs = await dust.listDocuments(dataSourceId);
        log.info({ count: docs.length }, 'pulled from dust');

        // Target orgs: explicit orgId from manual resync, or all orgs for scheduled poll.
        const targetOrgIds = data.orgId
          ? [data.orgId]
          : (await prisma.org.findMany({ select: { id: true } })).map((o) => o.id);

        const results = { opportunity: 0, company: 0, note: 0, lead: 0, skipped: 0, errors: 0 };

        for (const doc of docs) {
          try {
            const detail = await dust.getDocument(dataSourceId, doc.document_id);
            const meta = (detail.metadata ?? {}) as Record<string, unknown>;
            const metaOrgId = meta.org_id && typeof meta.org_id === 'string' ? meta.org_id : null;
            const orgsToProcess = metaOrgId ? [metaOrgId] : targetOrgIds;

            for (const orgId of orgsToProcess) {
              if (meta.opportunity_code && typeof meta.opportunity_code === 'string') {
                const res = await upsertOpportunityFromDust(orgId, detail);
                if (res.skipped) results.skipped++;
                else results.opportunity++;
              } else if (meta.lead_email && typeof meta.lead_email === 'string') {
                const res = await upsertLeadFromDust(orgId, detail);
                if (res.skipped) results.skipped++;
                else results.lead++;
              } else if (meta.company_name && typeof meta.company_name === 'string') {
                await upsertCompanyFromDust(orgId, detail);
                results.company++;
              } else {
                const note = await upsertNoteFromDust(orgId, detail);
                if (note) results.note++;
              }
            }
          } catch (docErr) {
            results.errors++;
            log.warn({ docId: doc.document_id, err: docErr }, 'failed to process dust document');
          }
        }

        for (const orgId of targetOrgIds) {
          await prisma.syncEvent.create({
            data: {
              orgId,
              source: 'dust.poll',
              eventType: 'poll.completed',
              payload: {
                documentCount: docs.length,
                ...results,
                orgCount: targetOrgIds.length,
              },
              status: 'processed',
              processedAt: new Date(),
            },
          });
        }

        consecutiveFailures = 0;
      } catch (err) {
        consecutiveFailures++;
        if (consecutiveFailures >= CIRCUIT_THRESHOLD) {
          circuitOpenUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
          log.error({ consecutiveFailures }, 'circuit opened');
        }
        throw err;
      }
    },
    { connection },
  );
  workers.push(worker);
}

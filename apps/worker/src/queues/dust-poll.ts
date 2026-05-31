// Repeating BullMQ job that pulls deltas from Dust every 5 minutes.
// When DUST_API_KEY is configured, documents are mapped to CRM entities
// based on metadata/tags. Otherwise stub sync_events are written for UI
// feedback.

import { Queue, Worker } from 'bullmq';
import type IORedis from 'ioredis';
import type pino from 'pino';
import { z } from 'zod';

import { prisma } from '@bidstack/db';
import { DUST_POLL } from '@bidstack/shared';
import {
  upsertOpportunityFromDust,
  upsertCompanyFromDust,
  upsertNoteFromDust,
  upsertLeadFromDust,
} from './dust-sync-helpers.js';
import { getOrgDust } from '../lib/dust-credentials.js';

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

/**
 * Poll one org's OWN Dust workspace and ingest its documents into that org.
 *
 * Per-org/plug-and-play model: each org brings its own Dust workspace (admins
 * enter the key + data source in Settings; the global DUST_* env still resolves
 * as a fallback for single-tenant deployments). Because the workspace belongs to
 * the org, every document in it is that org's — no cross-org metadata gate; the
 * metadata only routes a doc to the right entity type. Writes a stub sync_event
 * when the org has no Dust configured, so the integration UI still has feedback.
 */
async function pollOrgDust(orgId: string, log: pino.Logger): Promise<void> {
  const { client: dust, creds } = await getOrgDust(orgId, log.child({ orgId, kind: 'dust' }));
  const dataSourceId = creds?.dataSourceId;
  if (!dust || !dataSourceId) {
    await prisma.syncEvent.create({
      data: {
        orgId,
        source: 'dust.poll',
        eventType: 'tick.stub',
        payload: {
          reason: 'Dust not configured for org — add credentials + data source in Settings',
        },
        status: 'processed',
        processedAt: new Date(),
      },
    });
    return;
  }

  const docs = await dust.listDocuments(dataSourceId);
  log.info({ orgId, count: docs.length }, 'pulled from dust');
  const results = { opportunity: 0, company: 0, note: 0, lead: 0, skipped: 0, errors: 0 };

  for (const doc of docs) {
    try {
      const detail = await dust.getDocument(dataSourceId, doc.document_id);
      const meta = (detail.metadata ?? {}) as Record<string, unknown>;
      if (typeof meta.opportunity_code === 'string') {
        const res = await upsertOpportunityFromDust(orgId, detail);
        if (res.skipped) results.skipped++;
        else results.opportunity++;
      } else if (typeof meta.lead_email === 'string') {
        const res = await upsertLeadFromDust(orgId, detail);
        if (res.skipped) results.skipped++;
        else results.lead++;
      } else if (typeof meta.company_name === 'string') {
        await upsertCompanyFromDust(orgId, detail);
        results.company++;
      } else {
        const note = await upsertNoteFromDust(orgId, detail);
        if (note) results.note++;
      }
    } catch (docErr) {
      results.errors++;
      log.warn({ docId: doc.document_id, err: docErr }, 'failed to process dust document');
    }
  }

  await prisma.syncEvent.create({
    data: {
      orgId,
      source: 'dust.poll',
      eventType: 'poll.completed',
      payload: { documentCount: docs.length, ...results },
      status: 'processed',
      processedAt: new Date(),
    },
  });
}

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

      // Target orgs: explicit orgId from a manual resync, else every org for the
      // scheduled poll. Each org is polled against its OWN Dust workspace.
      const targetOrgIds = data.orgId
        ? [data.orgId]
        : (await prisma.org.findMany({ select: { id: true } })).map((o) => o.id);

      try {
        for (const orgId of targetOrgIds) {
          await pollOrgDust(orgId, log);
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

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

const FANOUT_JOB = 'dust.poll.fanout';
const ORG_BATCH_SIZE = 200;

/**
 * Fan out the scheduled tick: cursor-paginate every org and enqueue ONE
 * per-org poll job each, then return immediately. The cron job stays
 * lightweight (a few paginated DB reads + enqueues) so a tick always finishes
 * well inside its 5-min window even at 100k+ orgs — the heavy Dust I/O runs in
 * bounded per-org jobs drained by the worker's concurrency + limiter, instead
 * of being serialised into one ever-growing job that overlaps the next tick.
 */
async function fanoutOrgPolls(queue: Queue, log: pino.Logger): Promise<void> {
  // Window bucket dedups per-org jobs across overlapping fanout runs (e.g. a
  // delayed tick + the next on-time tick), mirroring email-sync's fanout.
  const windowBucket = Math.floor(Date.now() / REPEAT_EVERY_MS);
  let cursor: string | undefined;
  let dispatched = 0;

  while (true) {
    const batch = await prisma.org.findMany({
      select: { id: true },
      take: ORG_BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
    });
    if (batch.length === 0) break;

    for (const o of batch) {
      await queue.add(
        'dust.poll',
        { source: 'scheduled', orgId: o.id },
        { jobId: `dust-poll:${o.id}:${windowBucket}` },
      );
      dispatched++;
    }

    cursor = batch[batch.length - 1]!.id;
    if (batch.length < ORG_BATCH_SIZE) break;
  }

  log.info({ dispatched, windowBucket }, 'dust.poll fanout dispatched');
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

  // Lightweight cron: only fans out. jobId makes the repeatable registration
  // idempotent across restarts.
  await queue.add(
    FANOUT_JOB,
    { source: 'scheduled' },
    {
      jobId: 'dust-poll-fanout-cron',
      repeat: { every: REPEAT_EVERY_MS },
      removeOnComplete: { age: 3600, count: 100 },
      removeOnFail: { age: 86400 },
    },
  );

  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      // Fanout tick: enqueue per-org jobs and return. No Dust I/O here.
      if (job.name === FANOUT_JOB) {
        log.info({ jobId: job.id, name: job.name }, 'dust.poll fanout tick');
        await fanoutOrgPolls(queue, log);
        return;
      }

      const data = JobData.parse(job.data);
      log.info({ jobId: job.id, name: job.name, source: data.source }, 'dust.poll tick');

      // Per-org job. Covers both fanout-dispatched orgs and manual "Resync now"
      // (the API producer enqueues { orgId } directly). A poll job without an
      // orgId is a no-op — every real poll targets exactly one org's workspace.
      if (!data.orgId) {
        log.warn({ jobId: job.id }, 'dust.poll job missing orgId — skipping');
        return;
      }

      // Circuit breaker check
      if (Date.now() < circuitOpenUntil) {
        log.warn({ orgId: data.orgId }, 'circuit open, skipping dust poll');
        return;
      }

      try {
        await pollOrgDust(data.orgId, log);
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
    { connection, concurrency: 5, limiter: { max: 10, duration: 1_000 } },
  );
  workers.push(worker);
}

/**
 * meeting-intel queue worker. Job names:
 *   meeting-intel.scan     repeatable (hourly): enqueue a sync per connected source
 *   meeting-intel.sync     pull one connection (ABC org-level, Metis per user)
 *   meeting-intel.process  match, enrich, dedupe and flag one ingest item
 */
import { type Job, Queue, Worker } from 'bullmq';
import type IORedis from 'ioredis';
import type pino from 'pino';

import { prisma } from '@bidstack/db';
import { MEETING_INTEL, type MeetingIntelJob } from '@bidstack/shared';

import { defaultPipelineDeps, type PipelineDeps, processIngestItem, syncConnection } from '../meeting-intel/pipeline.js';

const SCAN_EVERY_MS = 60 * 60_000;

export async function scanMeetingSources(enqueue: PipelineDeps['enqueue']): Promise<number> {
  const conns = await prisma.meetingSourceConnection.findMany({
    where: { status: 'connected', source: { in: ['abc', 'metis'] } },
    select: { id: true, orgId: true },
    take: 5000,
  });
  for (const c of conns) await enqueue({ kind: 'sync', orgId: c.orgId, connectionId: c.id });
  return conns.length;
}

export async function startMeetingIntel(
  connection: IORedis,
  log: pino.Logger,
  workers: Worker[],
  queues: Queue[],
): Promise<void> {
  const queue = new Queue(MEETING_INTEL.name, { connection, defaultJobOptions: MEETING_INTEL.defaultJobOptions });
  queues.push(queue);
  const enqueue: PipelineDeps['enqueue'] = async (job) => {
    const id = job.kind === 'sync' ? `${job.orgId}--sync--${job.connectionId}--${Date.now()}` : `${job.orgId}--item--${job.itemId}`;
    await queue.add(`meeting-intel.${job.kind}`, job, { jobId: id });
  };
  const deps = defaultPipelineDeps(enqueue);
  const worker = new Worker<MeetingIntelJob | Record<string, never>>(
    MEETING_INTEL.name,
    async (job: Job<MeetingIntelJob | Record<string, never>>) => {
      if (job.name === 'meeting-intel.scan') return { enqueued: await scanMeetingSources(enqueue) };
      const data = job.data as MeetingIntelJob;
      const res = data.kind === 'sync' ? await syncConnection(data, deps) : await processIngestItem(data, deps);
      log.info({ jobId: job.id, orgId: data.orgId, kind: data.kind, ...res }, 'meeting intel job finished');
      return res;
    },
    { connection, concurrency: 2 },
  );
  worker.on('failed', (job, err) => {
    log.warn({ jobId: job?.id, err: err.message }, 'meeting intel job failed');
  });
  workers.push(worker);
  await queue.add('meeting-intel.scan', {}, { repeat: { every: SCAN_EVERY_MS }, jobId: 'meeting-intel-scan' });
  log.info({ queue: MEETING_INTEL.name }, 'meeting intel worker started');
}

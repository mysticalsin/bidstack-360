// Repeating BullMQ job that pulls deltas from Dust every 5 minutes.
// In v0.1 this just records a sync_event so the integration timeline UI
// has data; the real upsert lands when DUST_API_KEY is wired.

import { Queue, Worker } from 'bullmq';
import type IORedis from 'ioredis';
import type pino from 'pino';

import { prisma } from '@bidstack/db';
import { DustClient } from '@bidstack/dust-client';

const QUEUE_NAME = 'dust-poll';
const REPEAT_EVERY_MS = 5 * 60 * 1000;

export async function startDustPoller(connection: IORedis, log: pino.Logger): Promise<void> {
  const queue = new Queue(QUEUE_NAME, { connection });

  await queue.add(
    'dust.poll',
    { source: 'scheduled' },
    {
      repeat: { every: REPEAT_EVERY_MS },
      removeOnComplete: { age: 3600, count: 100 },
      removeOnFail: { age: 86400 },
    },
  );

  new Worker(
    QUEUE_NAME,
    async (job) => {
      log.info({ jobId: job.id, name: job.name }, 'dust.poll tick');

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
            payload: { reason: 'DUST_API_KEY/DUST_WORKSPACE_ID not set' },
            status: 'processed',
            processedAt: new Date(),
          })),
        });
        return;
      }

      const dust = new DustClient({ apiKey, workspaceId, logger: log.child({ kind: 'dust' }) });
      const docs = await dust.listDocuments(dataSourceId);
      log.info({ count: docs.length }, 'pulled from dust');
      // Real upsert into opportunities/contacts/documents lives in a future
      // sprint when we agree on the document schema with Dust.
    },
    { connection },
  );
}

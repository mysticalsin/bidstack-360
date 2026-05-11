// Drains sync_events with status='received' (those written by the API's
// /webhooks/dust receiver) and applies side effects (currently: mark
// processed + audit). Real document/opportunity reconciliation lands in a
// follow-up sprint when the Dust event payload schema is firmed up.

import { Queue, Worker } from 'bullmq';
import type IORedis from 'ioredis';
import type pino from 'pino';

import { prisma } from '@bidstack/db';
import { DUST_WEBHOOK_PROCESSOR } from '@bidstack/shared';

const QUEUE_NAME = DUST_WEBHOOK_PROCESSOR.name;
const TICK_MS = 10_000;

export async function startWebhookProcessor(
  connection: IORedis,
  log: pino.Logger,
  workers: Worker[],
  queues: Queue[],
): Promise<void> {
  const queue = new Queue(QUEUE_NAME, {
    connection,
    defaultJobOptions: DUST_WEBHOOK_PROCESSOR.defaultJobOptions,
  });
  queues.push(queue);

  await queue.add(
    'drain',
    {},
    {
      repeat: { every: TICK_MS },
      removeOnComplete: { age: 600, count: 50 },
      removeOnFail: { age: 86400 },
    },
  );

  const worker = new Worker(
    QUEUE_NAME,
    async () => {
      const batch = await prisma.syncEvent.findMany({
        where: { status: 'received', source: 'dust.webhook' },
        orderBy: { receivedAt: 'asc' },
        take: 100,
      });
      if (batch.length === 0) return;
      log.info({ batch: batch.length }, 'processing webhook batch');

      for (const evt of batch) {
        try {
          // Apply event-type specific logic here.
          // For v0.1 we just mark processed; real handlers land later.
          await prisma.syncEvent.update({
            where: { id: evt.id },
            data: { status: 'processed', processedAt: new Date() },
          });
        } catch (err) {
          await prisma.syncEvent.update({
            where: { id: evt.id },
            data: {
              status: 'error',
              error: err instanceof Error ? err.message : String(err),
              processedAt: new Date(),
            },
          });
        }
      }
    },
    { connection },
  );
  workers.push(worker);
}

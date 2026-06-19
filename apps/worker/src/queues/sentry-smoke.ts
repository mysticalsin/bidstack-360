import { Queue, Worker as BullWorker } from 'bullmq';
import type IORedis from 'ioredis';
import type pino from 'pino';
import { z } from 'zod';

import { SENTRY_SMOKE } from '@bidstack/shared';

const QUEUE_NAME = SENTRY_SMOKE.name;

const JobData = z.object({
  marker: z.string().min(1),
  release: z.string().min(1),
  environment: z.string().min(1),
  triggeredAt: z.string().datetime(),
});

export type SentrySmokeJobData = z.infer<typeof JobData>;

export async function processSentrySmokeJob(rawData: unknown): Promise<void> {
  const data = JobData.parse(rawData);
  throw new Error(
    `[bidstack-worker-sentry-smoke] marker=${data.marker} release=${data.release} environment=${data.environment}`,
  );
}

export async function startSentrySmokeWorker(
  connection: IORedis,
  log: pino.Logger,
  workers: BullWorker[],
  queues: Queue[],
): Promise<void> {
  const queue = new Queue<SentrySmokeJobData>(QUEUE_NAME, {
    connection,
    defaultJobOptions: SENTRY_SMOKE.defaultJobOptions,
  });
  queues.push(queue);

  const worker = new BullWorker<SentrySmokeJobData>(
    QUEUE_NAME,
    (job) => processSentrySmokeJob(job.data),
    {
      connection,
      concurrency: 1,
    },
  );
  workers.push(worker);
  log.info({ queue: QUEUE_NAME, concurrency: 1 }, 'Sentry smoke worker started');
}

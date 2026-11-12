// Test process for the migration deadlock suite. It runs the production
// worker until the suite stops it. Not a product entrypoint.
import { appendFileSync } from 'node:fs';

import type { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import pino from 'pino';

import { startMigrationWorker } from './migration.js';

const redisUrl = process.env.DEADLOCK_REDIS_URL;
const failLog = process.env.DEADLOCK_FAIL_LOG;
if (!redisUrl || !failLog) throw new Error('DEADLOCK_REDIS_URL and DEADLOCK_FAIL_LOG are required');

const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
const workers: Worker[] = [];
const queues: Queue[] = [];
await startMigrationWorker(connection, pino({ level: 'silent' }), workers, queues);
for (const worker of workers) {
  worker.on('failed', (_job, err) => {
    appendFileSync(failLog, `${err?.message ?? ''}\n`);
  });
}
process.stdout.write('READY\n');

await new Promise<void>((resolve) => {
  process.once('SIGTERM', () => resolve());
});
await Promise.all(workers.map((worker) => worker.close()));
await Promise.all(queues.map((queue) => queue.close()));
connection.disconnect();

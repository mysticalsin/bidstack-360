import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenvFlow from 'dotenv-flow';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenvFlow.config({ path: path.resolve(__dirname, '../../..'), silent: true });

import { type Queue, type Worker } from 'bullmq';
import IORedis from 'ioredis';
import pino from 'pino';

import { startCompanyEnrichApollo } from './queues/company-enrich-apollo.js';
import { startDustPoller } from './queues/dust-poll.js';
import { startWebhookProcessor } from './queues/webhook-processor.js';
import { startDocumentExtract } from './queues/document-extract.js';
import { startCalendarSync } from './queues/calendar-sync.js';
import { startEmailSync } from './queues/email-sync.js';
import { startSmsWorker } from './queues/sms.js';
import { startNativePushWorker } from './queues/notifications.js';
import { startWebhookDeliveryWorker } from './queues/webhook-delivery.js';
// Wave 8 — Y.js CRDT compaction
import { startYjsCompaction } from './queues/yjs-compaction.js';

const log = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport:
    process.env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true, singleLine: true } }
      : undefined,
  name: 'worker',
});

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6380';

const connection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
});

connection.on('error', (err) => log.error({ err }, 'redis error'));
connection.on('connect', () => log.info({ redisUrl }, 'redis connected'));

const workers: Worker[] = [];
const queues: Queue[] = [];

await Promise.all([
  startDustPoller(connection, log, workers, queues),
  startWebhookProcessor(connection, log, workers, queues),
  startCompanyEnrichApollo(connection, log, workers, queues),
  startDocumentExtract(connection, log, workers, queues),
  startCalendarSync(connection, log, workers, queues),
  startEmailSync(connection, log, workers, queues),
  startSmsWorker(connection, log, workers as never, queues),
  startNativePushWorker(connection, log, workers, queues),
  startWebhookDeliveryWorker(connection, log, workers, queues),
  startYjsCompaction(connection, log, workers, queues),
]);

log.info(
  'BidStack worker ready (dust-poll + webhook-processor + company-enrich-apollo + document-extract + calendar-sync + email-sync + sms + native-push + webhook-delivery + yjs-compact)',
);

const healthPort = Number(process.env.WORKER_HEALTH_PORT || 4002);

const healthServer = http.createServer((_req, res) => {
  const redisReady = connection.status === 'ready';
  res.writeHead(redisReady ? 200 : 503, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      status: redisReady ? 'ok' : 'error',
      queue: redisReady ? 'connected' : 'disconnected',
    }),
  );
});

healthServer.listen(healthPort, () => {
  log.info({ healthPort }, 'health server listening');
});

const shutdown = async (signal: string) => {
  log.info({ signal }, 'shutting down worker');
  const timeout = setTimeout(() => {
    log.error('forced exit after timeout');
    process.exit(1);
  }, 10_000);
  try {
    await Promise.all(workers.map((w) => w.close()));
    await Promise.all(queues.map((q) => q.close()));
    await connection.quit();
    healthServer.close();
    clearTimeout(timeout);
    process.exit(0);
  } catch (err) {
    log.error({ err }, 'shutdown error');
    clearTimeout(timeout);
    process.exit(1);
  }
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

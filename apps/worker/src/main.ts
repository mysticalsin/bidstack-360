import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenvFlow from 'dotenv-flow';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenvFlow.config({ path: path.resolve(__dirname, '../../..'), silent: true });

import IORedis from 'ioredis';
import pino from 'pino';

import { startDustPoller } from './queues/dust-poll.js';
import { startWebhookProcessor } from './queues/webhook-processor.js';

const log = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport:
    process.env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true, singleLine: true } }
      : undefined,
  name: 'worker',
});

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';

const connection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
});

connection.on('error', (err) => log.error({ err }, 'redis error'));
connection.on('connect', () => log.info({ redisUrl }, 'redis connected'));

await Promise.all([startDustPoller(connection, log), startWebhookProcessor(connection, log)]);

log.info('BidStack worker ready (dust-poll + webhook-processor)');

const shutdown = async (signal: string) => {
  log.info({ signal }, 'shutting down worker');
  await connection.quit();
  process.exit(0);
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

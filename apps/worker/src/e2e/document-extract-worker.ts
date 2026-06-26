import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { type Queue, type Worker } from 'bullmq';
import dotenvFlow from 'dotenv-flow';
import IORedis from 'ioredis';
import pino from 'pino';

import { prisma } from '@bidstack/db';

import { startDocumentExtract } from '../queues/document-extract.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenvFlow.config({ path: path.resolve(__dirname, '../../../..'), silent: true });

const log = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  name: 'document-extract-e2e',
});

const healthPort = Number(process.env.DOCUMENT_EXTRACT_WORKER_HEALTH_PORT);
if (!Number.isFinite(healthPort) || healthPort <= 0) {
  log.fatal(
    { healthPort: process.env.DOCUMENT_EXTRACT_WORKER_HEALTH_PORT ?? null },
    'DOCUMENT_EXTRACT_WORKER_HEALTH_PORT must be a positive port',
  );
  process.exit(1);
}
const healthHost = process.env.DOCUMENT_EXTRACT_WORKER_HEALTH_HOST ?? '127.0.0.1';

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6380';
const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
connection.on('error', (err) => log.error({ err }, 'redis error'));

const workers: Worker[] = [];
const queues: Queue[] = [];

await startDocumentExtract(connection, log, workers, queues);

const healthServer = http.createServer((_req, res) => {
  void (async () => {
    const redisReady = connection.status === 'ready';
    let dbReady = false;
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbReady = true;
    } catch {
      // Leave dbReady false; health stays 503 until Postgres is reachable.
    }
    const ok = redisReady && dbReady;
    res.writeHead(ok ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        status: ok ? 'ok' : 'error',
        queue: redisReady ? 'connected' : 'disconnected',
        db: dbReady ? 'connected' : 'disconnected',
      }),
    );
  })();
});

await new Promise<void>((resolve, reject) => {
  const onError = (err: Error) => reject(err);
  healthServer.once('error', onError);
  healthServer.listen(healthPort, healthHost, () => {
    healthServer.off('error', onError);
    resolve();
  });
});

log.info({ healthHost, healthPort }, 'document-extract e2e worker ready');

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ signal }, 'document-extract e2e worker shutting down');
  const timeout = setTimeout(() => {
    log.error('forced exit after shutdown timeout');
    process.exit(1);
  }, 10_000);

  try {
    await new Promise<void>((resolve) => healthServer.close(() => resolve()));
    await Promise.all(workers.map((worker) => worker.close()));
    await Promise.all(queues.map((queue) => queue.close()));
    await connection.quit();
    await prisma.$disconnect();
    clearTimeout(timeout);
    process.exit(0);
  } catch (err) {
    log.error({ err }, 'document-extract e2e worker shutdown failed');
    clearTimeout(timeout);
    process.exit(1);
  }
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => {
  log.fatal({ reason }, 'unhandledRejection');
  process.exit(1);
});
process.on('uncaughtException', (err) => {
  log.fatal({ err }, 'uncaughtException');
  process.exit(1);
});

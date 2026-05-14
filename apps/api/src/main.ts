// Load .env from the repo root regardless of where the process was started.
// `pnpm --filter @bidstack/api dev` runs with cwd=apps/api, but the canonical
// .env lives at the monorepo root.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenvFlow from 'dotenv-flow';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenvFlow.config({ path: path.resolve(__dirname, '../../..'), silent: true });

import { initSentry, shutdownSentry } from './instrument.js';
initSentry();

import { prisma } from '@bidstack/db';
import { buildServer } from './server.js';
import { getEnv } from './env.js';
import { redis } from './redis.js';
import { initTelemetry, shutdownTelemetry } from './otel.js';

// Fail fast on missing/invalid environment variables.
const env = getEnv();

const port = env.PORT_API;
const host = env.HOST;

initTelemetry();

const server = await buildServer();

// Global process hardening: log and exit on unrecoverable errors.
process.on('unhandledRejection', (reason, _promise) => {
  server.log.fatal({ reason }, 'unhandledRejection');
  process.exit(1);
});
process.on('uncaughtException', (err) => {
  server.log.fatal({ err }, 'uncaughtException');
  process.exit(1);
});

// Graceful shutdown: drain requests, close DB/Redis, then exit.
const shutdown = async (signal: string) => {
  server.log.info({ signal }, 'shutting down API');
  const timeout = setTimeout(() => {
    server.log.error('forced exit after shutdown timeout');
    process.exit(1);
  }, 15_000);
  try {
    await server.close();
    await prisma.$disconnect();
    await redis.quit();
    await shutdownSentry();
    await shutdownTelemetry();
    clearTimeout(timeout);
    server.log.info('shutdown complete');
    process.exit(0);
  } catch (err) {
    server.log.error({ err }, 'shutdown error');
    clearTimeout(timeout);
    process.exit(1);
  }
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

try {
  await server.listen({ port, host });
  server.log.info({ port, host }, 'BidStack 360° API ready');
} catch (err) {
  server.log.error(err, 'failed to start');
  process.exit(1);
}

// Load .env from the repo root regardless of where the process was started.
// `pnpm --filter @bidstack/api dev` runs with cwd=apps/api, but the canonical
// .env lives at the monorepo root.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenvFlow from 'dotenv-flow';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenvFlow.config({ path: path.resolve(__dirname, '../../..'), silent: true });

const { initSentry, shutdownSentry } = await import('./instrument.js');
initSentry();

// Start OpenTelemetry BEFORE importing @bidstack/db, ./server, ./redis — auto
// instrumentation patches modules (http, pg/Prisma, ioredis) at sdk.start() and
// only sees modules loaded AFTER it starts. Loading it last (as before) meant
// every instrumentable module was already required and went untraced. No-op when
// OTEL_EXPORTER_OTLP_ENDPOINT is unset (see otel.ts).
const { initTelemetry, shutdownTelemetry } = await import('./otel.js');
initTelemetry();

const { prisma } = await import('@bidstack/db');
const { buildServer } = await import('./server.js');
const { getEnv } = await import('./env.js');
const { redis } = await import('./redis.js');

// Fail fast on missing/invalid environment variables.
const env = getEnv();

const port = env.PORT_API;
const host = env.HOST;

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
  server.log.info({ port, host }, 'Polo PreSales API ready');
} catch (err) {
  server.log.error(err, 'failed to start');
  process.exit(1);
}

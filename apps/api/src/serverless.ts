/**
 * serverless.ts: the API as a single Vercel Function (Node runtime).
 *
 * The public demo (bidstack-demo.vercel.app) serves the SPA and this API from
 * one origin, so the browser never needs CORS or a baked absolute API origin.
 * The long-running entry (main.ts) still owns listen(), signals and shutdown;
 * here Fastify is built once per function instance and every request is
 * handed to its router.
 *
 * Nothing in this file runs background work: no BullMQ worker, no repeatable
 * job and no polling loop is started by buildServer(), and the worker app is
 * not deployed. Jobs the API enqueues simply wait in Redis.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { FastifyInstance } from 'fastify';

/**
 * Neon's pooled endpoint is PgBouncer in transaction mode. Prisma needs
 * `pgbouncer=true` there (no named prepared statements), and a function
 * instance should hold only a few connections. The URL comes from the Vercel
 * Marketplace integration, so it is adjusted here instead of by hand.
 */
export function tuneDatabaseUrl(raw: string | undefined): string | undefined {
  if (!raw) return raw;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }
  if (url.hostname.includes('-pooler.') && !url.searchParams.has('pgbouncer')) {
    url.searchParams.set('pgbouncer', 'true');
  }
  if (!url.searchParams.has('connection_limit')) {
    url.searchParams.set('connection_limit', process.env.POLO_SERVERLESS_DB_POOL ?? '5');
  }
  if (!url.searchParams.has('pool_timeout')) url.searchParams.set('pool_timeout', '20');
  return url.toString();
}

/** `/api/health` is the documented probe; the API serves it at `/health`. */
export function rewriteServerlessUrl(url: string | undefined): string {
  const value = url ?? '/';
  const match = /^\/api\/(health|livez|readyz)(?=$|\?)/.exec(value);
  return match ? `/${match[1]}${value.slice(match[0].length)}` : value;
}

let serverPromise: Promise<FastifyInstance> | null = null;

async function getServer(): Promise<FastifyInstance> {
  process.env.DATABASE_URL = tuneDatabaseUrl(process.env.DATABASE_URL);
  const { buildServer } = await import('./server.js');
  const server = await buildServer();
  await server.ready();
  return server;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  serverPromise ??= getServer().catch((err: unknown) => {
    // Let the next request retry a failed cold start instead of caching it.
    serverPromise = null;
    throw err;
  });
  let server: FastifyInstance;
  try {
    server = await serverPromise;
  } catch (err) {
    console.error('polo api cold start failed', err instanceof Error ? err.message : err);
    res.statusCode = 503;
    res.setHeader('content-type', 'application/json');
    res.setHeader('retry-after', '5');
    res.end(
      JSON.stringify({ error: 'api_starting', message: 'The API failed to start, retry shortly.' }),
    );
    return;
  }
  req.url = rewriteServerlessUrl(req.url);
  server.routing(req, res);
}

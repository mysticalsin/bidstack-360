/**
 * Fastify plugin that wraps every request in a query-tracking context.
 *
 * - Logs slow queries (>500ms) with Pino
 * - Rejects unbounded `findMany` without `take` limit in dev/test (warns in prod)
 * - Adds `X-Prisma-Time` and `X-Query-Warnings` response headers in dev
 * - Surfaces N+1 alerts when >10 identical model+action queries fire per request
 */

import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import {
  installPrismaMiddleware,
  withQueryContext,
  getQueryContext,
  SLOW_QUERY_MS,
  N_PLUS_ONE_THRESHOLD,
} from '../lib/prisma-middleware.js';

// Install the Prisma $use middleware once at module load.
installPrismaMiddleware();

const REJECT_UNBOUNDED = process.env.NODE_ENV !== 'production';

export const queryGuardPlugin: FastifyPluginAsync = fp(async (server) => {
  server.addHook('onRequest', (_req, _reply, done) => {
    // Wrap the remainder of the request lifecycle in an AsyncLocalStorage
    // context so the Prisma middleware can attribute queries to this request.
    withQueryContext(() => done());
  });

  server.addHook('onSend', async (req, reply, payload) => {
    const store = getQueryContext();
    if (!store) return payload;

    const warnings: string[] = [];

    // 1. Slow query logging
    const slow = store.queries.filter((q) => q.durationMs > SLOW_QUERY_MS);
    for (const q of slow) {
      req.log.warn(
        { model: q.model, operation: q.operation, durationMs: q.durationMs },
        'slow query detected',
      );
    }

    // 2. N+1 detection
    for (const [pattern, count] of store.patterns.entries()) {
      if (count > N_PLUS_ONE_THRESHOLD) {
        const msg = `N+1 detected: ${pattern} executed ${count} times in one request`;
        req.log.warn({ pattern, count, url: req.raw.url }, msg);
        warnings.push(msg);
      }
    }

    // 3. Unbounded findMany guard
    const unbounded = [...new Set(store.unboundedWarnings)];
    if (unbounded.length > 0) {
      const msg = `Unbounded findMany detected for: ${unbounded.join(', ')}`;
      if (REJECT_UNBOUNDED) {
        req.log.error({ unbounded, url: req.raw.url }, msg);
        reply.code(400);
        return JSON.stringify({
          error: 'Bad Request',
          message: `Unbounded queries are not allowed in development. Models affected: ${unbounded.join(', ')}`,
        });
      } else {
        req.log.warn({ unbounded, url: req.raw.url }, msg);
        warnings.push(msg);
      }
    }

    // 4. Dev response headers
    if (process.env.NODE_ENV === 'development') {
      reply.header('X-Prisma-Time', `${store.totalPrismaMs.toFixed(2)}ms`);
      reply.header('X-Query-Count', String(store.queries.length));
      if (warnings.length > 0) {
        reply.header('X-Query-Warnings', warnings.join('; '));
      }
    }

    return payload;
  });
});

/**
 * Prisma query middleware that attaches to the global singleton client.
 *
 * Responsibilities:
 * - Measure every query duration
 * - Detect N+1 patterns (>10 identical model+action queries in one request)
 * - Flag unbounded findMany calls missing a `take` limit
 *
 * Why `$use` instead of `$extends`?
 *   Prisma 5 recommends `$extends`, but `$use` lets us mutate the singleton
 *   exported by `@bidstack/db` in-place so zero route files need to change
 *   their import. This is a pragmatic migration step.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { prisma } from '@bidstack/db';

const SLOW_QUERY_MS = 500;
const N_PLUS_ONE_THRESHOLD = 10;

export interface QueryContext {
  /** Flat list of every Prisma query fired during the request */
  queries: Array<{
    model: string;
    operation: string;
    durationMs: number;
    args?: unknown;
  }>;
  /** model+operation → count map */
  patterns: Map<string, number>;
  /** Total wall-clock time spent in Prisma for this request */
  totalPrismaMs: number;
  /** Unbounded findMany warnings */
  unboundedWarnings: string[];
}

const requestStore = new AsyncLocalStorage<QueryContext>();

export function getQueryContext(): QueryContext | undefined {
  return requestStore.getStore();
}

/** Run a request-scoped function with a fresh query tracking context. */
export function withQueryContext<T>(fn: () => T): T {
  return requestStore.run(
    { queries: [], patterns: new Map(), totalPrismaMs: 0, unboundedWarnings: [] },
    fn,
  );
}

function isUnboundedFindMany(params: { action: string; args?: Record<string, unknown> }): boolean {
  if (params.action !== 'findMany') return false;
  const args = params.args ?? {};
  const take = args.take as number | undefined;
  if (take === undefined || take === null) return true;
  if (typeof take === 'number' && take > 1000) return true;
  return false;
}

/** Install the middleware exactly once. Idempotent. */
let installed = false;
export function installPrismaMiddleware(): void {
  if (installed) return;
  installed = true;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- WHY: Prisma $use callback signature is untyped in Prisma 5; params/next shapes are internal
  prisma.$use(async (params: any, next: any) => {
    const start = performance.now();
    const result = await next(params);
    const duration = performance.now() - start;

    const store = requestStore.getStore();
    if (store) {
      const model = params.model ?? 'unknown';
      const operation = params.action ?? 'unknown';
      const patternKey = `${model}.${operation}`;
      const count = (store.patterns.get(patternKey) ?? 0) + 1;
      store.patterns.set(patternKey, count);
      store.queries.push({ model, operation, durationMs: duration, args: params.args });
      store.totalPrismaMs += duration;

      if (count === N_PLUS_ONE_THRESHOLD + 1) {
        // Only log once when we cross the threshold
        // We don't have direct access to the Fastify logger here without
        // plumbing, so we rely on the query-guard plugin to surface this
        // by reading store.patterns in onSend.
      }

      if (isUnboundedFindMany(params)) {
        store.unboundedWarnings.push(patternKey);
      }
    }

    return result;
  });
}

export { SLOW_QUERY_MS, N_PLUS_ONE_THRESHOLD };

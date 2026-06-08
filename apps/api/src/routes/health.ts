/**
 * Health + metrics routes.
 *
 * Routes:
 *   GET /livez   — liveness probe (always 200 if process is alive)
 *   GET /readyz  — readiness probe (200 when DB + Redis + storage are ready)
 *   GET /health  — health check (DB + Redis ping, returns 200/503)
 *   GET /metrics — Prometheus exposition format
 *
 * Metrics implementation: built-in counter/gauge/histogram without external
 * dependencies (no prom-client). To upgrade to prom-client for richer
 * histogram buckets and push-gateway support, install prom-client and replace
 * the MetricsStore class with prom-client's Registry.
 *
 * Counters tracked:
 *   http_requests_total{method, route, status_code}
 *   http_request_duration_seconds{method, route} (histogram approximation)
 *   db_query_duration_seconds{operation} (histogram approximation)
 *   job_processed_total{queue}
 *   job_failed_total{queue}
 */

import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '@bidstack/db';

import { pingRedis } from '../redis.js';

// ── Health schemas ──────────────────────────────────────────────────────────

const CoreHealthSchema = z.object({
  ok: z.boolean(),
  db: z.boolean(),
  redis: z.boolean(),
});

const ReadinessSchema = CoreHealthSchema.extend({
  storage: z.boolean(),
});

// ── In-process metrics store ────────────────────────────────────────────────

interface LabelSet {
  [key: string]: string;
}

class Counter {
  private values = new Map<string, number>();
  constructor(
    public readonly name: string,
    public readonly help: string,
    public readonly labelNames: string[],
  ) {}

  inc(labels: LabelSet = {}, value = 1): void {
    const key = this.labelKey(labels);
    this.values.set(key, (this.values.get(key) ?? 0) + value);
  }

  expose(): string {
    const lines: string[] = [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} counter`,
    ];
    for (const [key, val] of this.values) {
      lines.push(`${this.name}${key} ${val}`);
    }
    return lines.join('\n');
  }

  private labelKey(labels: LabelSet): string {
    if (Object.keys(labels).length === 0) return '';
    const pairs = this.labelNames
      .filter((n) => n in labels)
      .map((n) => `${n}="${escapeLabel(labels[n] ?? '')}"`)
      .join(',');
    return `{${pairs}}`;
  }
}

/** Approximation of a histogram via sum + count (no buckets). */
class Histogram {
  private sums = new Map<string, number>();
  private counts = new Map<string, number>();
  constructor(
    public readonly name: string,
    public readonly help: string,
    public readonly labelNames: string[],
  ) {}

  observe(labels: LabelSet = {}, value: number): void {
    const key = this.labelKey(labels);
    this.sums.set(key, (this.sums.get(key) ?? 0) + value);
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
  }

  expose(): string {
    const lines: string[] = [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} summary`,
    ];
    for (const [key, count] of this.counts) {
      lines.push(`${this.name}_count${key} ${count}`);
      lines.push(`${this.name}_sum${key} ${(this.sums.get(key) ?? 0).toFixed(6)}`);
    }
    return lines.join('\n');
  }

  private labelKey(labels: LabelSet): string {
    if (Object.keys(labels).length === 0) return '';
    const pairs = this.labelNames
      .filter((n) => n in labels)
      .map((n) => `${n}="${escapeLabel(labels[n] ?? '')}"`)
      .join(',');
    return `{${pairs}}`;
  }
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

// ── Exported metric singletons ──────────────────────────────────────────────
// WHY: exported so route handlers and job processors can increment them
// without knowing about the HTTP layer.

export const httpRequestsTotal = new Counter(
  'http_requests_total',
  'Total HTTP requests processed',
  ['method', 'route', 'status_code'],
);

export const httpRequestDuration = new Histogram(
  'http_request_duration_seconds',
  'HTTP request duration in seconds',
  ['method', 'route'],
);

export const dbQueryDuration = new Histogram(
  'db_query_duration_seconds',
  'Prisma query duration in seconds',
  ['operation'],
);

export const jobProcessedTotal = new Counter(
  'job_processed_total',
  'BullMQ jobs successfully processed',
  ['queue'],
);

export const jobFailedTotal = new Counter(
  'job_failed_total',
  'BullMQ jobs that failed (all retries exhausted)',
  ['queue'],
);

// ── Collectors array (add new metrics here) ─────────────────────────────────

const ALL_METRICS = [
  httpRequestsTotal,
  httpRequestDuration,
  dbQueryDuration,
  jobProcessedTotal,
  jobFailedTotal,
];

function exposeAllMetrics(): string {
  const processUptimeLine = [
    '# HELP process_uptime_seconds Seconds since the process started',
    '# TYPE process_uptime_seconds gauge',
    `process_uptime_seconds ${process.uptime().toFixed(3)}`,
  ].join('\n');

  const processMemoryLine = [
    '# HELP process_resident_memory_bytes Resident set size in bytes',
    '# TYPE process_resident_memory_bytes gauge',
    `process_resident_memory_bytes ${process.memoryUsage().rss}`,
  ].join('\n');

  return [processUptimeLine, processMemoryLine, ...ALL_METRICS.map((m) => m.expose())].join(
    '\n\n',
  );
}

export function metricsAccessAllowed(
  headers: FastifyRequest['headers'],
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.NODE_ENV !== 'production') return true;
  const token = env.METRICS_BEARER_TOKEN?.trim();
  if (!token) return false;
  return headers.authorization === `Bearer ${token}`;
}

// ── Health probe helpers ────────────────────────────────────────────────────

async function probeCoreHealth(): Promise<z.infer<typeof CoreHealthSchema>> {
  let db: boolean;
  try {
    const t0 = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    dbQueryDuration.observe({ operation: 'ping' }, (Date.now() - t0) / 1000);
    db = true;
  } catch {
    db = false;
  }

  const redisOk = await pingRedis();

  return { ok: db && redisOk, db, redis: redisOk };
}

export function storageConfigReady(env: NodeJS.ProcessEnv = process.env): boolean {
  const driver = (env.STORAGE_DRIVER ?? 'local').toLowerCase();
  if (driver === 's3') {
    return Boolean(env.S3_BUCKET && env.S3_BUCKET.trim());
  }
  return env.NODE_ENV !== 'production';
}

// ── Route plugin ────────────────────────────────────────────────────────────

export const healthRoute: FastifyPluginAsyncZod = async (server) => {
  // Liveness — just proves the process is alive.
  server.get(
    '/livez',
    {
      config: { public: true },
      schema: { response: { 200: z.object({ ok: z.literal(true) }) } },
    },
    async () => ({ ok: true as const }),
  );

  // Readiness — checks DB + Redis + storage are operational.
  server.get(
    '/readyz',
    {
      config: { public: true },
      schema: {
        response: {
          200: ReadinessSchema,
          503: ReadinessSchema,
        },
      },
    },
    async (_req, reply) => {
      const core = await probeCoreHealth();
      const storage = storageConfigReady();
      const body = { ...core, ok: core.ok && storage, storage };
      if (!body.ok) reply.code(503);
      return body;
    },
  );

  // Detailed health — same as readyz but always returns 200 (useful for dashboards).
  server.get(
    '/health',
    {
      config: { public: true },
      schema: { response: { 200: CoreHealthSchema } },
    },
    async () => probeCoreHealth(),
  );

  // Prometheus metrics exposition. This stays outside user auth so Prometheus
  // can scrape it, but production requires an explicit bearer token.
  server.get(
    '/metrics',
    {
      config: { public: true },
      preHandler: async (req, reply) => {
        if (!metricsAccessAllowed(req.headers)) {
          reply.code(process.env.METRICS_BEARER_TOKEN ? 401 : 404);
          return reply.send('Not found');
        }
      },
    },
    async (_req, reply) => {
      reply.type('text/plain; version=0.0.4; charset=utf-8');
      return exposeAllMetrics();
    },
  );
};

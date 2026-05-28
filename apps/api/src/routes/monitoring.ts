/**
 * W10-P2-2 — Operational monitoring endpoints
 *
 * Routes:
 *   GET /api/v1/admin/monitoring/queues   — live BullMQ depth snapshot for every queue
 *   GET /api/v1/admin/monitoring/alerts   — computed alert conditions (for dashboards / PagerDuty)
 *   GET /api/v1/admin/monitoring/embeddings — embedding-specific failure stats
 *
 * All routes require auth. RBAC: admin role required in production; any authenticated
 * user can read in development (useful for local ops dashboards).
 *
 * Queue data is fetched live from Redis on every request — no caching, no stale state.
 * p50/p95/p99 latency data is NOT available here (those require Prometheus scrape);
 * use GET /metrics for histogram data.
 *
 * Alert thresholds (tuneable via env):
 *   MONITOR_QUEUE_DEPTH_WARN  — waiting depth that triggers a WARNING  (default 100)
 *   MONITOR_QUEUE_DEPTH_CRIT  — waiting depth that triggers a CRITICAL  (default 500)
 *   MONITOR_EMBED_FAIL_RATE   — embedding fail rate % that triggers CRITICAL (default 10)
 */

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import IORedis from 'ioredis';
import { Queue } from 'bullmq';
import { createLogger } from '../lib/logger.js';

const log = createLogger({ name: 'monitoring' });

// ─── Config ──────────────────────────────────────────────────────────────────

const QUEUE_DEPTH_WARN = Number(process.env.MONITOR_QUEUE_DEPTH_WARN ?? 100);
const QUEUE_DEPTH_CRIT = Number(process.env.MONITOR_QUEUE_DEPTH_CRIT ?? 500);
const EMBED_FAIL_RATE_CRIT = Number(process.env.MONITOR_EMBED_FAIL_RATE ?? 10);

/** All BullMQ queue names known to BidStack 360°. */
const ALL_QUEUE_NAMES = [
  // Core CRM / enrichment
  'company.enrich-apollo',
  'dust.poll',
  'document.extract',
  'webhook.delivery',
  // Email / calendar
  'email.outlook.pull-incremental',
  'email.outlook.pull-historical',
  'email.outlook.subscription-renew',
  // RFP pipeline
  'rfp.orchestrate',
  'rfp.requirement-extract',
  'rfp.story-match',
  'rfp.compliance-fill',
  'rfp.section-draft',
  'rfp.legal-scan',
  'rfp.qa-review',
  'rfp.embed-reference',
  'rfp.embed-requirement',
] as const;

const EMBED_QUEUE_NAMES = new Set(['rfp.embed-reference', 'rfp.embed-requirement']);

// ─── Zod schemas ─────────────────────────────────────────────────────────────

const QueueDepthSchema = z.object({
  queue: z.string(),
  waiting: z.number(),
  active: z.number(),
  delayed: z.number(),
  failed: z.number(),
  completed: z.number(),
  paused: z.boolean(),
});

const AlertSeverity = z.enum(['ok', 'warning', 'critical']);

const QueueAlertSchema = z.object({
  queue: z.string(),
  severity: AlertSeverity,
  reason: z.string().optional(),
  waiting: z.number(),
  failed: z.number(),
});

const EmbedStatsSchema = z.object({
  queue: z.string(),
  failed: z.number(),
  completed: z.number(),
  failRatePct: z.number(),
  severity: AlertSeverity,
});

// ─── Redis connection (lazy singleton) ───────────────────────────────────────

let redisSingleton: IORedis | null = null;

function getRedis(): IORedis {
  if (redisSingleton) return redisSingleton;
  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6380';
  redisSingleton = new IORedis(redisUrl, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    lazyConnect: true,
  });
  redisSingleton.on('error', (err) => {
    log.error({ err }, 'monitoring: Redis connection error');
  });
  return redisSingleton;
}

// ─── BullMQ queue depth fetch ────────────────────────────────────────────────

interface QueueDepth {
  queue: string;
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
  paused: boolean;
  error?: string;
}

async function fetchQueueDepth(name: string, connection: IORedis): Promise<QueueDepth> {
  const q = new Queue(name, { connection });
  try {
    const [waiting, active, delayed, failed, completed, isPaused] = await Promise.all([
      q.getWaitingCount(),
      q.getActiveCount(),
      q.getDelayedCount(),
      q.getFailedCount(),
      q.getCompletedCount(),
      q.isPaused(),
    ]);
    return { queue: name, waiting, active, delayed, failed, completed, paused: isPaused };
  } catch (err) {
    log.warn({ err, queue: name }, 'monitoring: failed to fetch queue depth');
    return {
      queue: name,
      waiting: -1,
      active: -1,
      delayed: -1,
      failed: -1,
      completed: -1,
      paused: false,
      error: String(err),
    };
  } finally {
    // WHY close after each call: Queue objects hold a Redis connection per instance.
    // We share the base connection so close() only releases BullMQ's internal client,
    // not the shared IORedis socket.
    await q.close();
  }
}

// ─── Alert computation ───────────────────────────────────────────────────────

function computeQueueAlert(depth: QueueDepth): z.infer<typeof QueueAlertSchema> {
  if (depth.waiting >= QUEUE_DEPTH_CRIT) {
    return {
      queue: depth.queue,
      severity: 'critical',
      reason: `Waiting depth ${depth.waiting} ≥ ${QUEUE_DEPTH_CRIT} (CRITICAL threshold)`,
      waiting: depth.waiting,
      failed: depth.failed,
    };
  }
  if (depth.waiting >= QUEUE_DEPTH_WARN) {
    return {
      queue: depth.queue,
      severity: 'warning',
      reason: `Waiting depth ${depth.waiting} ≥ ${QUEUE_DEPTH_WARN} (WARNING threshold)`,
      waiting: depth.waiting,
      failed: depth.failed,
    };
  }
  return { queue: depth.queue, severity: 'ok', waiting: depth.waiting, failed: depth.failed };
}

function computeEmbedStats(depth: QueueDepth): z.infer<typeof EmbedStatsSchema> {
  const total = depth.completed + depth.failed;
  const failRatePct = total > 0 ? (depth.failed / total) * 100 : 0;
  const severity: z.infer<typeof AlertSeverity> =
    failRatePct >= EMBED_FAIL_RATE_CRIT ? 'critical' : 'ok';
  return {
    queue: depth.queue,
    failed: depth.failed,
    completed: depth.completed,
    failRatePct: Math.round(failRatePct * 100) / 100,
    severity,
  };
}

// ─── Route plugin ────────────────────────────────────────────────────────────

export const monitoringRoutes: FastifyPluginAsyncZod = async (server) => {
  /**
   * GET /admin/monitoring/queues
   * Returns live queue depths for all known BullMQ queues.
   * Admin-only in production; any authed user in development (for ops dashboards).
   */
  server.get(
    '/admin/monitoring/queues',
    {
      schema: {
        summary: 'Live BullMQ queue depth snapshot',
        tags: ['monitoring'],
        response: {
          200: z.object({
            timestamp: z.string(),
            queues: z.array(QueueDepthSchema),
          }),
        },
      },
    },
    async () => {
      const connection = getRedis();
      const depths = await Promise.all(
        ALL_QUEUE_NAMES.map((name) => fetchQueueDepth(name, connection)),
      );

      return {
        timestamp: new Date().toISOString(),
        queues: depths.map((d) => ({
          queue: d.queue,
          waiting: Math.max(0, d.waiting),
          active: Math.max(0, d.active),
          delayed: Math.max(0, d.delayed),
          failed: Math.max(0, d.failed),
          completed: Math.max(0, d.completed),
          paused: d.paused,
        })),
      };
    },
  );

  /**
   * GET /admin/monitoring/alerts
   * Computed alert conditions across all queues.
   * Returns severity=critical when any queue exceeds MONITOR_QUEUE_DEPTH_CRIT.
   * Returns severity=warning when any queue exceeds MONITOR_QUEUE_DEPTH_WARN.
   */
  server.get(
    '/admin/monitoring/alerts',
    {
      schema: {
        summary: 'Queue alert conditions (for PagerDuty / Grafana alerting)',
        tags: ['monitoring'],
        response: {
          200: z.object({
            timestamp: z.string(),
            overallSeverity: AlertSeverity,
            thresholds: z.object({
              queueDepthWarn: z.number(),
              queueDepthCrit: z.number(),
              embedFailRateCritPct: z.number(),
            }),
            queueAlerts: z.array(QueueAlertSchema),
            embeddingAlerts: z.array(EmbedStatsSchema),
          }),
        },
      },
    },
    async () => {
      const connection = getRedis();
      const depths = await Promise.all(
        ALL_QUEUE_NAMES.map((name) => fetchQueueDepth(name, connection)),
      );

      const queueAlerts = depths.map(computeQueueAlert);
      const embeddingAlerts = depths
        .filter((d) => EMBED_QUEUE_NAMES.has(d.queue))
        .map(computeEmbedStats);

      // Overall severity = worst across all alert types
      const severityRank = { ok: 0, warning: 1, critical: 2 };
      const maxQueue = queueAlerts.reduce(
        (max, a) => (severityRank[a.severity] > severityRank[max] ? a.severity : max),
        'ok' as z.infer<typeof AlertSeverity>,
      );
      const maxEmbed = embeddingAlerts.reduce(
        (max, a) => (severityRank[a.severity] > severityRank[max] ? a.severity : max),
        'ok' as z.infer<typeof AlertSeverity>,
      );
      const overallSeverity =
        severityRank[maxQueue] >= severityRank[maxEmbed] ? maxQueue : maxEmbed;

      return {
        timestamp: new Date().toISOString(),
        overallSeverity,
        thresholds: {
          queueDepthWarn: QUEUE_DEPTH_WARN,
          queueDepthCrit: QUEUE_DEPTH_CRIT,
          embedFailRateCritPct: EMBED_FAIL_RATE_CRIT,
        },
        queueAlerts,
        embeddingAlerts,
      };
    },
  );

  /**
   * GET /admin/monitoring/embeddings
   * Embedding-specific failure stats for rfp.embed-reference and rfp.embed-requirement.
   * Used by the embedding failure rate panel in the ops dashboard.
   */
  server.get(
    '/admin/monitoring/embeddings',
    {
      schema: {
        summary: 'Embedding queue failure rate stats',
        tags: ['monitoring'],
        response: {
          200: z.object({
            timestamp: z.string(),
            queues: z.array(EmbedStatsSchema),
            criticalFailRateThresholdPct: z.number(),
          }),
        },
      },
    },
    async () => {
      const connection = getRedis();
      const depths = await Promise.all(
        [...EMBED_QUEUE_NAMES].map((name) => fetchQueueDepth(name, connection)),
      );

      return {
        timestamp: new Date().toISOString(),
        queues: depths.map(computeEmbedStats),
        criticalFailRateThresholdPct: EMBED_FAIL_RATE_CRIT,
      };
    },
  );
};

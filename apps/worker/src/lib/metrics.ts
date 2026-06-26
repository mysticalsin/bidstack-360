/**
 * Prometheus metrics for the BullMQ worker process.
 *
 * Mirrors the API's metrics surface (see apps/api/src/routes/health.ts) but
 * backed by prom-client so the worker exposes a real /metrics endpoint with
 * histogram buckets and default Node.js process/GC collectors.
 *
 * Metrics:
 *   bidstack_worker_jobs_processed_total{queue}  — counter, jobs that completed
 *   bidstack_worker_jobs_failed_total{queue}     — counter, jobs that failed
 *   bidstack_worker_jobs_active{queue}           — gauge, jobs currently active
 *   bidstack_worker_job_duration_seconds{queue}  — histogram of processing time
 *   bidstack_worker_queue_depth{queue,state}     — gauge, waiting/active depth
 *
 * WHY a dedicated registry (not the global default): keeps worker metrics
 * isolated and testable, and lets callers reset state between tests.
 */

import type { Queue, Worker } from 'bullmq';
import type pino from 'pino';
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';

export const registry = new Registry();

// Node.js process + GC + event-loop metrics (process_cpu_seconds_total, etc.).
collectDefaultMetrics({ register: registry });

export const jobsProcessedTotal = new Counter({
  name: 'bidstack_worker_jobs_processed_total',
  help: 'BullMQ jobs successfully processed, by queue',
  labelNames: ['queue'],
  registers: [registry],
});

export const jobsFailedTotal = new Counter({
  name: 'bidstack_worker_jobs_failed_total',
  help: 'BullMQ jobs that failed, by queue',
  labelNames: ['queue'],
  registers: [registry],
});

export const jobsActive = new Gauge({
  name: 'bidstack_worker_jobs_active',
  help: 'BullMQ jobs currently being processed, by queue',
  labelNames: ['queue'],
  registers: [registry],
});

export const jobDurationSeconds = new Histogram({
  name: 'bidstack_worker_job_duration_seconds',
  help: 'BullMQ job processing duration in seconds, by queue',
  labelNames: ['queue'],
  // Job runtimes span sub-second polls to multi-minute LLM/extraction jobs.
  buckets: [0.1, 0.5, 1, 5, 15, 30, 60, 120, 300],
  registers: [registry],
});

export const queueDepth = new Gauge({
  name: 'bidstack_worker_queue_depth',
  help: 'BullMQ queue depth by state (waiting, active)',
  labelNames: ['queue', 'state'],
  registers: [registry],
});

/**
 * Wire job-lifecycle counters/histogram into a single BullMQ worker.
 *
 * Mirrors datadog.ts semantics but emits Prometheus metrics. Safe to call
 * unconditionally — no external collector or API key required.
 */
export function attachMetricsToWorker(worker: Worker, queueName: string): void {
  worker.on('active', () => {
    jobsActive.inc({ queue: queueName });
  });

  worker.on('completed', (job) => {
    jobsActive.dec({ queue: queueName });
    jobsProcessedTotal.inc({ queue: queueName });
    // finishedOn/processedOn are epoch millis set by BullMQ on the job record.
    const durationMs =
      job.finishedOn && job.processedOn ? job.finishedOn - job.processedOn : 0;
    if (durationMs > 0) {
      jobDurationSeconds.observe({ queue: queueName }, durationMs / 1000);
    }
  });

  worker.on('failed', (job) => {
    jobsActive.dec({ queue: queueName });
    jobsFailedTotal.inc({ queue: queueName });
    const durationMs =
      job?.finishedOn && job.processedOn ? job.finishedOn - job.processedOn : 0;
    if (durationMs > 0) {
      jobDurationSeconds.observe({ queue: queueName }, durationMs / 1000);
    }
  });
}

/**
 * Poll waiting/active counts for every queue into the queue-depth gauge.
 *
 * WHY a poller (vs. event-driven): waiting depth has no per-job event; a
 * periodic gauge is the standard Prometheus pattern for backpressure
 * detection. Returns a stop() to clear the interval on shutdown.
 */
export function startQueueDepthCollector(
  queues: Queue[],
  log: pino.Logger,
  intervalMs = 30_000,
): { stop: () => void } {
  const collect = async (): Promise<void> => {
    for (const queue of queues) {
      try {
        const [waiting, active] = await Promise.all([
          queue.getWaitingCount(),
          queue.getActiveCount(),
        ]);
        queueDepth.set({ queue: queue.name, state: 'waiting' }, waiting);
        queueDepth.set({ queue: queue.name, state: 'active' }, active);
      } catch (err) {
        log.warn({ err, queue: queue.name }, 'failed to collect queue depth metric');
      }
    }
  };

  void collect();
  const interval = setInterval(() => void collect(), intervalMs);
  // Do not keep the event loop alive solely for metric polling.
  interval.unref();

  return { stop: () => clearInterval(interval) };
}

/** Prometheus exposition text for the worker registry. */
export async function renderMetrics(): Promise<string> {
  return registry.metrics();
}

/** Guard /metrics the same way the API does: token required in production. */
export function metricsAccessAllowed(
  authorization: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.NODE_ENV !== 'production') return true;
  const token = env.METRICS_BEARER_TOKEN?.trim();
  if (!token) return false;
  return authorization === `Bearer ${token}`;
}

/**
 * Datadog APM + StatsD init for BullMQ workers.
 *
 * Worker-specific custom metrics:
 *  bidstack.workers.jobs.processed  — tagged: queue, status (success|failed)
 *  bidstack.workers.job.duration    — histogram in ms, tagged: queue
 *  bidstack.workers.queue.depth     — gauge per queue (polled on cron)
 *
 * WHY logInjection=true: correlates Pino log lines to Datadog traces.
 * Workers emit structured JSON logs; Datadog's log pipeline picks up
 * dd.trace_id and dd.span_id fields for trace-log correlation.
 *
 * DD_API_KEY is never logged. If absent, init is a no-op.
 */

import type { Queue, Worker } from 'bullmq';
import type pino from 'pino';

let tracerInitialized = false;

export function initWorkerDatadog(log: pino.Logger): void {
  if (tracerInitialized) return;
  tracerInitialized = true;

  const apiKey = process.env.DD_API_KEY;
  if (!apiKey) {
    log.debug('DD_API_KEY not set — Datadog disabled for worker');
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const tracer = require('dd-trace');
  tracer.init({
    service: process.env.DD_SERVICE ?? 'bidstack-worker',
    env: process.env.DD_ENV ?? process.env.NODE_ENV ?? 'development',
    version: process.env.DD_VERSION,
    logInjection: true,
    runtimeMetrics: true,
    profiling: process.env.DD_PROFILING_ENABLED === 'true',
    plugins: true, // auto-instruments Redis/BullMQ/pg
  });

  log.info({ service: process.env.DD_SERVICE }, 'Datadog worker tracer initialized');
}

/**
 * Attach Datadog metrics emission to a BullMQ worker.
 * Tracks per-job duration and success/failure counts.
 */
export function attachDatadogToWorker(
  worker: Worker,
  queueName: string,
  log: pino.Logger,
): void {
  if (!process.env.DD_API_KEY) return;

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const tracer = require('dd-trace');

  worker.on('completed', (job, _result, prev) => {
    const duration = job.finishedOn && job.processedOn ? job.finishedOn - job.processedOn : 0;
    const tags = [`queue:${queueName}`, `job:${job.name}`, 'status:success'];
    tracer.dogstatsd?.increment('bidstack.workers.jobs.processed', 1, tags);
    if (duration > 0) {
      tracer.dogstatsd?.histogram('bidstack.workers.job.duration', duration, tags);
    }
    log.debug({ queue: queueName, jobId: job.id, duration, prev }, 'Job completed');
  });

  worker.on('failed', (job, _err) => {
    const tags = [`queue:${queueName}`, `job:${job?.name ?? 'unknown'}`, 'status:failed'];
    tracer.dogstatsd?.increment('bidstack.workers.jobs.processed', 1, tags);
  });
}

/**
 * Start a periodic queue depth metric emission.
 * WHY: Datadog monitors on queue depth are critical for detecting
 * backpressure before it causes SLA breaches.
 * Interval: every 30 seconds.
 */
export function startQueueDepthMetrics(queues: Queue[], log: pino.Logger): void {
  if (!process.env.DD_API_KEY) return;

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const tracer = require('dd-trace');

  const emit = async () => {
    for (const queue of queues) {
      try {
        const waiting = await queue.getWaitingCount();
        const active = await queue.getActiveCount();
        const tags = [`queue:${queue.name}`];
        tracer.dogstatsd?.gauge('bidstack.workers.queue.depth', waiting + active, tags);
      } catch (err) {
        log.warn({ err, queue: queue.name }, 'Failed to emit queue depth metric');
      }
    }
  };

  // Emit immediately, then every 30 s
  void emit();
  const interval = setInterval(() => void emit(), 30_000);
  // Prevent the interval from keeping Node alive after graceful shutdown
  interval.unref();
}

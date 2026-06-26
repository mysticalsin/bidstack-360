import { EventEmitter } from 'node:events';

import type { Queue, Worker } from 'bullmq';
import pino from 'pino';
import { afterEach, describe, expect, it } from 'vitest';

import {
  attachMetricsToWorker,
  jobDurationSeconds,
  jobsActive,
  jobsFailedTotal,
  jobsProcessedTotal,
  metricsAccessAllowed,
  queueDepth,
  registry,
  renderMetrics,
  startQueueDepthCollector,
} from './metrics.js';

const log = pino({ level: 'silent' });

// WHY reset: prom-client metrics are process-global singletons; without a reset
// between tests, counter values leak across cases and assertions become flaky.
afterEach(() => {
  jobsProcessedTotal.reset();
  jobsFailedTotal.reset();
  jobsActive.reset();
  jobDurationSeconds.reset();
  queueDepth.reset();
});

/** Minimal Worker stand-in: only the EventEmitter surface attachMetrics uses. */
function fakeWorker(): EventEmitter & Worker {
  return new EventEmitter() as unknown as EventEmitter & Worker;
}

describe('attachMetricsToWorker', () => {
  it('increments processed + observes duration on completed (so dashboards see throughput)', async () => {
    const worker = fakeWorker();
    attachMetricsToWorker(worker, 'demo-queue');

    worker.emit('active');
    // processedOn/finishedOn are epoch millis BullMQ stamps; 2s duration here.
    worker.emit('completed', { processedOn: 1_000, finishedOn: 3_000 });

    expect(await jobsProcessedTotal.get().then((m) => m.values[0]?.value)).toBe(1);
    // active was incremented then decremented back to 0.
    expect(await jobsActive.get().then((m) => m.values[0]?.value)).toBe(0);
    const dur = await jobDurationSeconds.get();
    const sum = dur.values.find((v) => v.metricName === 'bidstack_worker_job_duration_seconds_sum');
    expect(sum?.value).toBeCloseTo(2, 5);
  });

  it('increments failed (not processed) on failed so failure alerts fire', async () => {
    const worker = fakeWorker();
    attachMetricsToWorker(worker, 'demo-queue');

    worker.emit('active');
    worker.emit('failed', { processedOn: 1_000, finishedOn: 1_500 });

    expect(await jobsFailedTotal.get().then((m) => m.values[0]?.value)).toBe(1);
    expect(await jobsProcessedTotal.get().then((m) => m.values[0]?.value ?? 0)).toBe(0);
    expect(await jobsActive.get().then((m) => m.values[0]?.value)).toBe(0);
  });
});

describe('startQueueDepthCollector', () => {
  it('sets waiting + active gauges from queue counts (backpressure visibility)', async () => {
    const queue = {
      name: 'depth-queue',
      getWaitingCount: async () => 7,
      getActiveCount: async () => 2,
    } as unknown as Queue;

    const collector = startQueueDepthCollector([queue], log, 60_000);
    // Allow the immediate void collect() microtasks to settle.
    await new Promise((r) => setImmediate(r));
    collector.stop();

    const depth = await queueDepth.get();
    const waiting = depth.values.find((v) => v.labels.state === 'waiting');
    const active = depth.values.find((v) => v.labels.state === 'active');
    expect(waiting?.value).toBe(7);
    expect(active?.value).toBe(2);
  });
});

describe('metricsAccessAllowed', () => {
  it('allows scraping in non-production without a token', () => {
    expect(metricsAccessAllowed(undefined, { NODE_ENV: 'development' } as NodeJS.ProcessEnv)).toBe(
      true,
    );
  });

  it('denies in production when no token is configured (fail closed)', () => {
    expect(metricsAccessAllowed('Bearer x', { NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toBe(
      false,
    );
  });

  it('requires the exact bearer token in production', () => {
    const env = { NODE_ENV: 'production', METRICS_BEARER_TOKEN: 'secret' } as NodeJS.ProcessEnv;
    expect(metricsAccessAllowed('Bearer secret', env)).toBe(true);
    expect(metricsAccessAllowed('Bearer wrong', env)).toBe(false);
  });
});

describe('renderMetrics', () => {
  it('exposes the worker job metric families in Prometheus text format', async () => {
    const worker = fakeWorker();
    attachMetricsToWorker(worker, 'render-queue');
    worker.emit('active');
    worker.emit('completed', { processedOn: 1_000, finishedOn: 2_000 });

    const text = await renderMetrics();
    expect(text).toContain('bidstack_worker_jobs_processed_total');
    expect(text).toContain('bidstack_worker_job_duration_seconds');
    expect(registry).toBeDefined();
  });
});

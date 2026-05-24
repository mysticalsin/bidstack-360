/**
 * Sentry Node SDK init for BullMQ workers.
 *
 * WHY a separate init from apps/api:
 * Workers run in a different process. Sentry's global scope is per-process.
 * Sharing init config keeps DSN/environment consistent but the SDKs are
 * independent instances.
 *
 * BullMQ error capture:
 * Workers emit 'failed' events for each job that exhausts retries. We wrap
 * the worker event listener to capture to Sentry with job metadata as tags,
 * making it easy to find error clusters by queue/job type in Sentry.
 *
 * PII scrubbing:
 * Same approach as apps/api/src/plugins/sentry.ts — job data may contain
 * phone numbers or emails (e.g., bulk SMS recipients). Strip before send.
 */

import * as Sentry from '@sentry/node';
import type { Worker } from 'bullmq';
import type pino from 'pino';

const PII_FIELDS = new Set([
  'email', 'phone', 'phoneNumber', 'phone_number',
  'name', 'firstName', 'lastName', 'first_name', 'last_name',
  'toNumber', 'fromNumber', 'to_number', 'from_number',
  'password', 'secret', 'token', 'apiKey', 'api_key', 'authToken', 'auth_token',
]);

function scrubPii(obj: unknown, depth = 0): unknown {
  if (depth > 10 || obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map((item) => scrubPii(item, depth + 1));
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    result[key] = PII_FIELDS.has(key) ? '[REDACTED]' : scrubPii(value, depth + 1);
  }
  return result;
}

export function initWorkerSentry(log: pino.Logger): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    log.debug('SENTRY_DSN not set — Sentry disabled for worker');
    return;
  }

  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development',
    release: process.env.SENTRY_RELEASE,
    tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.05'),
    beforeSend(event) {
      if (event.extra) {
        event.extra = scrubPii(event.extra) as Record<string, unknown>;
      }
      return event;
    },
  });

  log.info({ environment: process.env.SENTRY_ENVIRONMENT }, 'Sentry worker SDK initialized');
}

/**
 * Attach Sentry error capture to a BullMQ worker's 'failed' event.
 *
 * WHY wrap rather than instrument globally: BullMQ workers swallow exceptions
 * internally and emit them as 'failed' events. Sentry's auto-instrumentation
 * does not catch these. We explicitly capture on 'failed' with job metadata.
 */
export function attachSentryToWorker(worker: Worker, queueName: string, log: pino.Logger): void {
  if (!process.env.SENTRY_DSN) return;

  worker.on('failed', (job, err) => {
    const jobData = scrubPii(job?.data ?? {});
    Sentry.withScope((scope) => {
      scope.setTag('queue', queueName);
      scope.setTag('jobName', job?.name ?? 'unknown');
      scope.setContext('job', {
        id: job?.id,
        name: job?.name,
        attemptsMade: job?.attemptsMade,
        data: jobData,
      });
      Sentry.captureException(err);
    });
    log.error({ jobId: job?.id, queue: queueName, err }, 'Job failed — reported to Sentry');
  });
}

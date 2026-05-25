/**
 * Customer Success BullMQ workers.
 *
 * Queues:
 *   cs.compute-health-scores    — nightly, all active accounts
 *   cs.send-nps-surveys         — quarterly or milestone-triggered
 *   cs.detect-churn-signals     — nightly
 *   cs.surface-expansion-ops    — weekly
 *   cs.create-renewal-opps      — daily, accounts approaching renewal
 *
 * WHY five separate queues: each job has different SLA, frequency, and failure
 * isolation needs. Health score recomputation must not block NPS dispatch.
 */

import { Queue, Worker } from 'bullmq';
import type IORedis from 'ioredis';
import type pino from 'pino';
import { z } from 'zod';

import { prisma } from '@bidstack/db';
import {
  computeAndPersistHealthScore,
  processRenewalOpportunities,
  sendQuarterlyNpsSurveys,
  runOrgChurnDetection,
  surfaceExpansionOpportunities,
} from '../services/cs/index.js';

// ─── Queue names ─────────────────────────────────────────────────────────

export const CS_HEALTH_QUEUE = 'cs.compute-health-scores';
export const CS_NPS_QUEUE = 'cs.send-nps-surveys';
export const CS_CHURN_QUEUE = 'cs.detect-churn-signals';
export const CS_EXPANSION_QUEUE = 'cs.surface-expansion-ops';
export const CS_RENEWAL_QUEUE = 'cs.create-renewal-opps';

// ─── Job data schemas ─────────────────────────────────────────────────────

// Schemas kept for future use when individual account/org jobs are enqueued.
const _OrgJobData = z.object({ orgId: z.string().uuid() });
const _AccountJobData = z.object({ orgId: z.string().uuid(), accountId: z.string().uuid() });
type OrgJobData = z.infer<typeof _OrgJobData>;

// Silence unused-var warnings — these are reference schemas.
void _OrgJobData;
void _AccountJobData;

// ─── Default job options ──────────────────────────────────────────────────

const defaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 10_000 },
  removeOnComplete: { age: 86_400, count: 500 },
  removeOnFail: { age: 7 * 86_400 },
};

// ─── Health score worker ──────────────────────────────────────────────────

async function startHealthScoreWorker(
  connection: IORedis,
  log: pino.Logger,
  workers: Worker[],
  queues: Queue[],
): Promise<void> {
  const queue = new Queue(CS_HEALTH_QUEUE, { connection, defaultJobOptions });
  queues.push(queue);

  // Nightly at 01:00 UTC.
  await queue.add('cs.health.nightly', {}, {
    repeat: { pattern: '0 1 * * *' },
    removeOnComplete: { age: 86_400, count: 10 },
  });

  const worker = new Worker<OrgJobData | Record<string, never>>(
    CS_HEALTH_QUEUE,
    async (job) => {
      log.info({ jobId: job.id }, 'cs.health: starting nightly health score pass');

      // Load all orgs with active subscriptions.
      const orgs = await prisma.org.findMany({
        where: {
          deletedAt: null,
          subscriptions: { some: { status: 'ACTIVE', deletedAt: null } },
        },
        select: { id: true },
      });

      let total = 0;
      for (const org of orgs) {
        const accounts = await prisma.subscription.findMany({
          where: { orgId: org.id, status: 'ACTIVE', deletedAt: null },
          select: { accountId: true },
          distinct: ['accountId'],
        });

        for (const { accountId } of accounts) {
          try {
            await computeAndPersistHealthScore(org.id, accountId, log);
            total++;
          } catch (err) {
            log.warn({ err, orgId: org.id, accountId }, 'cs.health: score compute failed, continuing');
          }
        }
      }

      log.info({ total }, 'cs.health: nightly pass complete');
    },
    {
      connection,
      concurrency: 5,
    },
  );

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'cs.health: job failed');
  });

  workers.push(worker);
}

// ─── NPS survey worker ────────────────────────────────────────────────────

async function startNpsWorker(
  connection: IORedis,
  log: pino.Logger,
  workers: Worker[],
  queues: Queue[],
): Promise<void> {
  const queue = new Queue(CS_NPS_QUEUE, { connection, defaultJobOptions });
  queues.push(queue);

  // Quarterly dispatch: 1st of Jan, Apr, Jul, Oct at 09:00 UTC.
  await queue.add('cs.nps.quarterly', {}, {
    repeat: { pattern: '0 9 1 1,4,7,10 *' },
    removeOnComplete: { age: 86_400, count: 10 },
  });

  const worker = new Worker<Record<string, never>>(
    CS_NPS_QUEUE,
    async (job) => {
      log.info({ jobId: job.id }, 'cs.nps: dispatching quarterly surveys');

      const orgs = await prisma.org.findMany({
        where: { deletedAt: null },
        select: { id: true },
      });

      for (const org of orgs) {
        try {
          const count = await sendQuarterlyNpsSurveys(org.id, log);
          log.info({ orgId: org.id, count }, 'cs.nps: surveys dispatched');
        } catch (err) {
          log.warn({ err, orgId: org.id }, 'cs.nps: dispatch failed, continuing');
        }
      }
    },
    { connection, concurrency: 2 },
  );

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'cs.nps: job failed');
  });

  workers.push(worker);
}

// ─── Churn detection worker ───────────────────────────────────────────────

async function startChurnDetectionWorker(
  connection: IORedis,
  log: pino.Logger,
  workers: Worker[],
  queues: Queue[],
): Promise<void> {
  const queue = new Queue(CS_CHURN_QUEUE, { connection, defaultJobOptions });
  queues.push(queue);

  // Nightly at 02:00 UTC.
  await queue.add('cs.churn.nightly', {}, {
    repeat: { pattern: '0 2 * * *' },
    removeOnComplete: { age: 86_400, count: 10 },
  });

  const worker = new Worker<Record<string, never>>(
    CS_CHURN_QUEUE,
    async (job) => {
      log.info({ jobId: job.id }, 'cs.churn: starting nightly detection');

      const orgs = await prisma.org.findMany({
        where: { deletedAt: null },
        select: { id: true },
      });

      for (const org of orgs) {
        try {
          const signals = await runOrgChurnDetection(org.id, log);
          if (signals > 0) {
            log.warn({ orgId: org.id, signals }, 'cs.churn: new signals detected');
          }
        } catch (err) {
          log.warn({ err, orgId: org.id }, 'cs.churn: org detection failed, continuing');
        }
      }
    },
    { connection, concurrency: 3 },
  );

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'cs.churn: job failed');
  });

  workers.push(worker);
}

// ─── Expansion worker ─────────────────────────────────────────────────────

async function startExpansionWorker(
  connection: IORedis,
  log: pino.Logger,
  workers: Worker[],
  queues: Queue[],
): Promise<void> {
  const queue = new Queue(CS_EXPANSION_QUEUE, { connection, defaultJobOptions });
  queues.push(queue);

  // Weekly on Monday at 07:00 UTC.
  await queue.add('cs.expansion.weekly', {}, {
    repeat: { pattern: '0 7 * * 1' },
    removeOnComplete: { age: 86_400, count: 10 },
  });

  const worker = new Worker<Record<string, never>>(
    CS_EXPANSION_QUEUE,
    async (job) => {
      log.info({ jobId: job.id }, 'cs.expansion: weekly surface pass');

      const orgs = await prisma.org.findMany({
        where: { deletedAt: null },
        select: { id: true },
      });

      for (const org of orgs) {
        try {
          await surfaceExpansionOpportunities(org.id, log);
        } catch (err) {
          log.warn({ err, orgId: org.id }, 'cs.expansion: org pass failed, continuing');
        }
      }
    },
    { connection, concurrency: 2 },
  );

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'cs.expansion: job failed');
  });

  workers.push(worker);
}

// ─── Renewal opportunities worker ─────────────────────────────────────────

async function startRenewalWorker(
  connection: IORedis,
  log: pino.Logger,
  workers: Worker[],
  queues: Queue[],
): Promise<void> {
  const queue = new Queue(CS_RENEWAL_QUEUE, { connection, defaultJobOptions });
  queues.push(queue);

  // Daily at 00:30 UTC.
  await queue.add('cs.renewal.daily', {}, {
    repeat: { pattern: '30 0 * * *' },
    removeOnComplete: { age: 86_400, count: 10 },
  });

  const worker = new Worker<Record<string, never>>(
    CS_RENEWAL_QUEUE,
    async (job) => {
      log.info({ jobId: job.id }, 'cs.renewal: daily renewal opportunity pass');

      const orgs = await prisma.org.findMany({
        where: { deletedAt: null },
        select: { id: true },
      });

      for (const org of orgs) {
        try {
          const created = await processRenewalOpportunities(org.id, log);
          if (created > 0) {
            log.info({ orgId: org.id, created }, 'cs.renewal: opportunities created');
          }
        } catch (err) {
          log.warn({ err, orgId: org.id }, 'cs.renewal: org pass failed, continuing');
        }
      }
    },
    { connection, concurrency: 3 },
  );

  worker.on('failed', (job, err) => {
    log.error({ jobId: job?.id, err }, 'cs.renewal: job failed');
  });

  workers.push(worker);
}

// ─── Exported entry point ─────────────────────────────────────────────────

/**
 * Register all CS BullMQ workers and queues.
 * Called from apps/worker/src/index.ts alongside other startXxx functions.
 */
export async function startCsWorkers(
  connection: IORedis,
  log: pino.Logger,
  workers: Worker[],
  queues: Queue[],
): Promise<void> {
  await Promise.all([
    startHealthScoreWorker(connection, log, workers, queues),
    startNpsWorker(connection, log, workers, queues),
    startChurnDetectionWorker(connection, log, workers, queues),
    startExpansionWorker(connection, log, workers, queues),
    startRenewalWorker(connection, log, workers, queues),
  ]);
  log.info('cs: all CS workers registered');
}

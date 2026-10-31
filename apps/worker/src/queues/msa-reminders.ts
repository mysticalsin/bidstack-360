/**
 * MSA renewal / expiry reminder worker (queue `msa.reminders`).
 *
 * A repeatable scan (every 6 hours) over active agreements creates in-app
 * notifications for the agreement owner, or its creator when no owner is set.
 * See msa-reminders.helpers.ts for which reminders fire.
 *
 * Idempotency: each (contract, reminder, term) has a deterministic url; the
 * existence check is the fast path and the partial unique index
 * notifications_msa_reminder_dedupe_uq turns a racing insert into P2002.
 */

import { Queue, Worker, type Job } from 'bullmq';
import type IORedis from 'ioredis';
import type pino from 'pino';

import { prisma, Prisma } from '@bidstack/db';

import {
  MSA_MAX_NOTICE_DAYS,
  MSA_REMINDER_DAYS,
  NOTICE_LEAD_DAYS,
  dueReminders,
  msaReminderUrl,
  reminderCopy,
  utcDay,
} from './msa-reminders.helpers.js';

const QUEUE_NAME = 'msa.reminders';
const SCAN_INTERVAL_MINUTES = 360;
const SCAN_BATCH_SIZE = 1000;
const JOB_OPTIONS = {
  attempts: 2,
  backoff: { type: 'fixed' as const, delay: 30_000 },
  removeOnComplete: { age: 86_400, count: 50 },
  removeOnFail: { age: 86_400 * 7, count: 500 },
};

export async function scanMsaReminders(now = new Date()): Promise<{ scanned: number; created: number }> {
  const today = new Date(utcDay(now));
  const horizon = new Date(today.getTime() + Math.max(...MSA_REMINDER_DAYS) * 86_400_000);
  // A long notice period puts the notice deadline before the 90-day window,
  // so rows with a notice period are scanned up to the longest allowed one.
  const noticeHorizon = new Date(today.getTime() + (MSA_MAX_NOTICE_DAYS + NOTICE_LEAD_DAYS) * 86_400_000);
  const rows = await prisma.contractAgreement.findMany({
    where: {
      status: 'active',
      deletedAt: null,
      expiryDate: { gte: today, lte: noticeHorizon },
      OR: [{ expiryDate: { lte: horizon } }, { noticePeriodDays: { gt: 0 } }],
    },
    select: {
      id: true,
      orgId: true,
      title: true,
      reference: true,
      expiryDate: true,
      noticePeriodDays: true,
      autoRenew: true,
      ownerId: true,
      createdById: true,
      company: { select: { name: true } },
    },
    orderBy: [{ expiryDate: 'asc' }, { id: 'asc' }],
    take: SCAN_BATCH_SIZE,
  });

  let created = 0;
  for (const row of rows) {
    const userId = row.ownerId ?? row.createdById;
    if (!userId || !row.expiryDate) continue;
    const title = row.title ?? row.reference;
    for (const r of dueReminders(row, now)) {
      const url = msaReminderUrl(row.id, r.kind, row.expiryDate);
      const existing = await prisma.notification.findFirst({
        where: { orgId: row.orgId, userId, url },
        select: { id: true },
      });
      if (existing) continue;
      const copy = reminderCopy({ title, companyName: row.company?.name ?? null, autoRenew: row.autoRenew }, r);
      try {
        await prisma.notification.create({
          data: {
            orgId: row.orgId,
            userId,
            // 'system': the only worker-emittable type without a shared enum change.
            type: 'system',
            title: copy.title.slice(0, 250),
            body: copy.body,
            entityType: 'msa',
            entityId: row.id,
            url,
          },
        });
        created += 1;
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') continue;
        throw err;
      }
    }
  }
  return { scanned: rows.length, created };
}

export async function startMsaReminders(
  connection: IORedis,
  log: pino.Logger,
  workers: Worker[],
  queues: Queue[],
): Promise<void> {
  const queue = new Queue(QUEUE_NAME, { connection, defaultJobOptions: JOB_OPTIONS });
  queues.push(queue);
  const worker = new Worker(
    QUEUE_NAME,
    async (_job: Job) => {
      const res = await scanMsaReminders();
      log.info({ queue: QUEUE_NAME, ...res }, 'msa reminder scan finished');
      return res;
    },
    { connection, concurrency: 1 },
  );
  worker.on('failed', (job, err) => {
    log.warn({ jobId: job?.id, err: err.message }, 'msa reminder scan failed');
  });
  workers.push(worker);
  await queue.add('msa-reminder-scan', {}, { repeat: { every: SCAN_INTERVAL_MINUTES * 60_000 }, jobId: 'msa-reminder-scan' });
  log.info({ queue: QUEUE_NAME, intervalMinutes: SCAN_INTERVAL_MINUTES }, 'msa reminder worker started');
}

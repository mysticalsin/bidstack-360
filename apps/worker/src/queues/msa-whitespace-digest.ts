/**
 * Weekly MSA whitespace digest (queue `msa.whitespace-digest`).
 *
 * Every Monday each owner gets one in-app notification with their top 3 new
 * whitespace flags. The email version is a draft returned by the API; this
 * worker never sends mail.
 *
 * Idempotency: the url carries the ISO week; the existence check is the fast
 * path and notifications_msa_whitespace_digest_uq turns a racing insert into
 * P2002.
 */

import { Queue, Worker, type Job } from 'bullmq';
import type IORedis from 'ioredis';
import type pino from 'pino';

import { loadWhitespaceFlags, prisma, Prisma } from '@bidstack/db';
import { buildWhitespaceDigest, isoWeek, type WhitespaceFlag } from '@bidstack/shared';

const QUEUE_NAME = 'msa.whitespace-digest';
const DIGEST_CRON = '0 12 * * 1'; // Mondays 12:00 UTC
const ORG_BATCH = 500;
const JOB_OPTIONS = {
  attempts: 2,
  backoff: { type: 'fixed' as const, delay: 60_000 },
  removeOnComplete: { age: 86_400 * 7, count: 20 },
  removeOnFail: { age: 86_400 * 14, count: 100 },
};

export async function runWhitespaceDigest(now = new Date()): Promise<{ orgs: number; created: number }> {
  const week = isoWeek(now);
  const orgs = await prisma.contractAgreement.findMany({
    where: { deletedAt: null, status: 'active', companyId: { not: null }, signingEntityId: { not: null } },
    distinct: ['orgId'],
    select: { orgId: true },
    take: ORG_BATCH,
  });
  let created = 0;
  for (const { orgId } of orgs) {
    const flags = await loadWhitespaceFlags(prisma, orgId, { orgId, deletedAt: null }, { now: now.getTime() });
    const byOwner = new Map<string, { name: string; flags: WhitespaceFlag[] }>();
    for (const f of flags) {
      if (!f.owner) continue;
      const entry = byOwner.get(f.owner.id) ?? { name: f.owner.name, flags: [] };
      entry.flags.push(f);
      byOwner.set(f.owner.id, entry);
    }
    for (const [userId, entry] of byOwner) {
      const digest = buildWhitespaceDigest(entry.flags, { ownerName: entry.name, week });
      if (!digest) continue;
      const existing = await prisma.notification.findFirst({ where: { orgId, userId, url: digest.url }, select: { id: true } });
      if (existing) continue;
      try {
        await prisma.notification.create({
          data: {
            orgId,
            userId,
            type: 'system',
            title: digest.title,
            body: digest.body,
            entityType: 'msa_whitespace',
            entityId: digest.flags[0]!.msaId,
            url: digest.url,
          },
        });
        created += 1;
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') continue;
        throw err;
      }
    }
  }
  return { orgs: orgs.length, created };
}

export async function startMsaWhitespaceDigest(
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
      const res = await runWhitespaceDigest();
      log.info({ queue: QUEUE_NAME, ...res }, 'msa whitespace digest finished');
      return res;
    },
    { connection, concurrency: 1 },
  );
  worker.on('failed', (job, err) => {
    log.warn({ jobId: job?.id, err: err.message }, 'msa whitespace digest failed');
  });
  workers.push(worker);
  await queue.add('msa-whitespace-digest', {}, { repeat: { pattern: DIGEST_CRON }, jobId: 'msa-whitespace-digest' });
  log.info({ queue: QUEUE_NAME }, 'msa whitespace digest worker started');
}

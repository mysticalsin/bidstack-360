/**
 * consulting-partners queue worker (slice 15). Job names:
 *   consulting-partners.refresh  scan one account (Refresh on the account page)
 *   consulting-partners.sweep    repeatable (daily): prune evidence older than
 *                                three years, rescan our own records on
 *                                accounts whose notes, meetings or deals
 *                                changed in the last day (activities, emails
 *                                and win/loss wait for Refresh), and when
 *                                CONSULTING_PARTNERS_AUTO_REFRESH=true run a
 *                                full refresh for stale key and top accounts
 */
import { loadOrgFirmCatalog, prisma, prunePartnerEvidence, savePartnerEvidence, scanInternalPartnerEvidence } from '@bidstack/db';
import { CONSULTING_PARTNERS, type ConsultingPartnersQueueJob } from '@bidstack/shared';
import { type Job, Queue, Worker } from 'bullmq';
import type IORedis from 'ioredis';
import type pino from 'pino';

import { defaultIntelFetch } from '../lib/account-intel/http.js';
import { partnerLlm, prismaPartnerStore } from '../lib/consulting-partners/prisma-store.js';
import { llmPartnerRemarks, runConsultingPartners } from '../lib/consulting-partners/run.js';

const DAY_MS = 24 * 60 * 60_000;
const STALE_DAYS = 14;

async function sweep(queue: Queue, env: NodeJS.ProcessEnv, log: pino.Logger): Promise<{ rescanned: number; enqueued: number }> {
  const limit = env.CONSULTING_PARTNERS_AUTO_REFRESH === 'true' ? Number(env.CONSULTING_PARTNERS_SWEEP_LIMIT ?? 25) || 25 : 0;
  const now = new Date();
  const since = new Date(now.getTime() - DAY_MS);
  let rescanned = 0;
  let enqueued = 0;
  const orgs = await prisma.org.findMany({ select: { id: true }, orderBy: { id: 'asc' }, take: 2000 });
  for (const org of orgs) {
    const pruned = await prunePartnerEvidence(prisma, org.id, now);
    if (pruned) log.info({ orgId: org.id, pruned }, 'consulting partner retention applied');
    const touched = await prisma.consultingPartnerEvidence.findMany({ where: { orgId: org.id }, select: { companyId: true }, distinct: ['companyId'], take: 500 });
    const changed = await prisma.company.findMany({
      where: {
        orgId: org.id,
        deletedAt: null,
        id: { in: touched.map((t) => t.companyId) },
        OR: [{ notes: { some: { updatedAt: { gte: since } } } }, { meetingIntel: { some: { updatedAt: { gte: since } } } }, { opportunities: { some: { updatedAt: { gte: since } } } }],
      },
      select: { id: true },
      take: 200,
    });
    if (changed.length) {
      const firms = await loadOrgFirmCatalog(prisma, org.id, env.CONSULTING_PARTNER_FIRMS);
      const llm = env.CONSULTING_PARTNERS_LLM === 'true' ? await partnerLlm(org.id) : null;
      for (const c of changed) {
        const drafts = await scanInternalPartnerEvidence(prisma, { orgId: org.id, companyId: c.id, firms, now });
        if (llm) await llmPartnerRemarks(drafts, firms, llm);
        await savePartnerEvidence(prisma, { orgId: org.id, companyId: c.id, drafts, now, replaceInternal: true });
        rescanned++;
      }
    }
    if (enqueued >= limit) continue;
    const stale = new Date(now.getTime() - STALE_DAYS * DAY_MS);
    const accounts = await prisma.company.findMany({
      where: { orgId: org.id, deletedAt: null, OR: [{ tier: { in: ['key', 'top'] } }, { topAccountRank: { not: null } }], NOT: { partnerRuns: { some: { lastFetchedAt: { gte: stale } } } } },
      select: { id: true },
      take: limit - enqueued,
    });
    for (const a of accounts) {
      await queue.add('consulting-partners.refresh', { kind: 'refresh', orgId: org.id, companyId: a.id }, { jobId: `${org.id}--partners--${a.id}--${Math.floor(now.getTime() / 60_000)}` });
      enqueued++;
    }
  }
  return { rescanned, enqueued };
}

/** Start the consulting-partners worker and its daily sweep. */
export async function startConsultingPartners(connection: IORedis, log: pino.Logger, workers: Worker[], queues: Queue[], env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const queue = new Queue(CONSULTING_PARTNERS.name, { connection, defaultJobOptions: CONSULTING_PARTNERS.defaultJobOptions });
  queues.push(queue);
  const store = prismaPartnerStore(env);
  const fetchImpl = defaultIntelFetch();

  const worker = new Worker<ConsultingPartnersQueueJob>(
    CONSULTING_PARTNERS.name,
    async (job: Job<ConsultingPartnersQueueJob>) => {
      const data = job.data;
      if (data.kind === 'sweep') return sweep(queue, env, log);
      try {
        const llm = env.CONSULTING_PARTNERS_LLM === 'true' ? await partnerLlm(data.orgId) : null;
        const res = await runConsultingPartners({ orgId: data.orgId, companyId: data.companyId }, { store, env, fetchImpl, now: new Date(), llm });
        log.info({ jobId: job.id, orgId: data.orgId, companyId: data.companyId, status: res.status, counts: res.counts }, 'consulting partners refresh finished');
        return res;
      } catch (err) {
        await prisma.consultingPartnerRun.updateMany({
          where: { orgId: data.orgId, companyId: data.companyId, status: { in: ['queued', 'running'] } },
          data: { status: 'failed', detail: (err as Error).message.slice(0, 500) },
        });
        throw err;
      }
    },
    // One account at a time keeps GDELT and Google News well inside their polite rate.
    { connection, concurrency: 1, limiter: { max: 6, duration: 60_000 } },
  );
  worker.on('failed', (job, err) => {
    log.warn({ jobId: job?.id, err: err.message }, 'consulting partners job failed');
  });
  workers.push(worker);

  await queue.add('consulting-partners.sweep', { kind: 'sweep' }, { repeat: { every: DAY_MS }, jobId: 'consulting-partners-sweep' });
  log.info({ queue: CONSULTING_PARTNERS.name, autoRefresh: env.CONSULTING_PARTNERS_AUTO_REFRESH === 'true' }, 'consulting partners worker started');
}

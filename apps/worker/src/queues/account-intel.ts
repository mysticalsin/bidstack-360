/**
 * account-intel queue worker (slice 12). Job names:
 *   account-intel.refresh          refresh chosen sources for one account (from the account page)
 *   account-intel.sweep            repeatable (daily): apply retention, and when
 *                                  ACCOUNT_INTEL_AUTO_REFRESH=true refresh stale key and top accounts
 *   account-intel.financials-scan  repeatable (daily) filings scan for tier-gated accounts, on when
 *                                  a contact User-Agent is set, unless FINANCIALS_SCAN_ENABLED=false
 *   account-intel.full-refresh     every public source plus Apollo organization data for one
 *                                  company, then its list summary (manual Refresh, imports)
 */
import { intelConnections, prisma, pruneImportBatches, recomputeCompanyIntelSummary } from '@bidstack/db';
import { ACCOUNT_INTEL, IntelSourceKey, type AccountIntelQueueJob } from '@bidstack/shared';
import { type Job, Queue, Worker } from 'bullmq';
import type IORedis from 'ioredis';
import type pino from 'pino';

import { runFinancialsScan } from '../lib/financials/scan.js';
import { defaultIntelFetch, intelUserAgent } from '../lib/account-intel/http.js';
import { financialsForAccount, prismaIntelStore, pruneAccountIntel } from '../lib/account-intel/prisma-store.js';
import { runAccountIntel } from '../lib/account-intel/run.js';
import { fullRefreshDeps, runCompanyFullRefresh } from '../lib/company-intel/full-refresh.js';

const DAY_MS = 24 * 60 * 60_000;
const STALE_DAYS = 7;

/** One refresh job per account and minute, so double clicks collapse. */
export function intelJobId(orgId: string, companyId: string, at: Date = new Date()): string {
  return `${orgId}--intel--${companyId}--${Math.floor(at.getTime() / 60_000)}`;
}

async function sweep(queue: Queue, env: NodeJS.ProcessEnv, log: pino.Logger): Promise<{ enqueued: number }> {
  const limit = env.ACCOUNT_INTEL_AUTO_REFRESH === 'true' ? Number(env.ACCOUNT_INTEL_SWEEP_LIMIT ?? 25) || 25 : 0;
  const now = new Date();
  const stale = new Date(now.getTime() - STALE_DAYS * DAY_MS);
  let enqueued = 0;
  const orgs: Array<{ id: string }> = [];
  for (let cursor: string | undefined; ; ) {
    const page = await prisma.org.findMany({ select: { id: true }, orderBy: { id: 'asc' }, take: 500, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    orgs.push(...page);
    if (page.length < 500) break;
    cursor = page[page.length - 1]!.id;
  }
  for (const org of orgs) {
    const pruned = await pruneAccountIntel(org.id, now);
    if (pruned.postings || pruned.posts || pruned.evidence) log.info({ orgId: org.id, ...pruned }, 'account intel retention applied');
    await pruneImportBatches(prisma, org.id, now).catch(() => 0);
    if (enqueued >= limit) continue;
    const accounts = await prisma.company.findMany({
      where: { orgId: org.id, deletedAt: null, OR: [{ tier: { in: ['key', 'top'] } }, { topAccountRank: { not: null } }], NOT: { intelRuns: { some: { source: 'hiring', lastFetchedAt: { gte: stale } } } } },
      select: { id: true },
      take: limit - enqueued,
    });
    for (const a of accounts) {
      await queue.add('account-intel.refresh', { kind: 'refresh', orgId: org.id, companyId: a.id, sources: [...IntelSourceKey.options] }, { jobId: intelJobId(org.id, a.id, now) });
      enqueued++;
    }
  }
  return { enqueued };
}

/** Start the account-intel worker and its schedules. */
export async function startAccountIntel(connection: IORedis, log: pino.Logger, workers: Worker[], queues: Queue[], env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const queue = new Queue(ACCOUNT_INTEL.name, { connection, defaultJobOptions: ACCOUNT_INTEL.defaultJobOptions });
  queues.push(queue);
  const store = prismaIntelStore();
  const fetchImpl = defaultIntelFetch();
  const financials = financialsForAccount(env, log);
  const full = fullRefreshDeps({ env, store, intelFetch: fetchImpl, financials });

  const worker = new Worker<AccountIntelQueueJob>(
    ACCOUNT_INTEL.name,
    async (job: Job<AccountIntelQueueJob>) => {
      const data = job.data;
      if (data.kind === 'sweep') return sweep(queue, env, log);
      if (data.kind === 'financials-scan') {
        const s = await runFinancialsScan({ env, log });
        log.info({ jobId: job.id, scheduled: s.scheduled, paused: s.paused, due: s.due, pulled: s.pulled.length }, 'scheduled financials scan finished');
        return { due: s.due, pulled: s.pulled.length };
      }
      if (data.kind === 'full-refresh') {
        const finalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
        const res = await runCompanyFullRefresh(data, full, { finalAttempt });
        log.info({ jobId: job.id, orgId: data.orgId, companyId: data.companyId, batchId: data.batchId, intel: res.intel, apollo: res.apollo }, 'company intel full refresh finished');
        return res;
      }
      let res: Awaited<ReturnType<typeof runAccountIntel>>;
      try {
        res = await runAccountIntel({ orgId: data.orgId, companyId: data.companyId, sources: data.sources }, { store, env, fetchImpl, now: new Date(), financials });
      } catch (err) {
        await prisma.intelSourceRun.updateMany({
          where: { orgId: data.orgId, companyId: data.companyId, source: { in: data.sources }, status: { in: ['queued', 'running'] } },
          data: { status: 'failed', detail: (err as Error).message.slice(0, 500) },
        });
        throw err;
      }
      await recomputeCompanyIntelSummary(prisma, data.orgId, data.companyId, { now: new Date(), connections: intelConnections(env) }).catch((err: Error) => log.warn({ companyId: data.companyId, err: err.message }, 'intel summary not rebuilt'));
      log.info({ jobId: job.id, orgId: data.orgId, companyId: data.companyId, results: Object.fromEntries(Object.entries(res).map(([k, v]) => [k, v?.status])) }, 'account intel refresh finished');
      return res;
    },
    // One account at a time keeps every public source well inside its polite rate.
    { connection, concurrency: 1, limiter: { max: 20, duration: 60_000 } },
  );
  worker.on('failed', (job, err) => {
    log.warn({ jobId: job?.id, err: err.message }, 'account intel job failed');
  });
  workers.push(worker);

  await queue.add('account-intel.sweep', { kind: 'sweep' }, { repeat: { every: DAY_MS }, jobId: 'account-intel-sweep' });
  const financialsScan = env.FINANCIALS_SCAN_ENABLED !== 'false' && intelUserAgent(env) !== null;
  if (financialsScan) {
    await queue.add('account-intel.financials-scan', { kind: 'financials-scan' }, { repeat: { every: DAY_MS }, jobId: 'account-intel-financials-scan' });
  }
  log.info({ queue: ACCOUNT_INTEL.name, autoRefresh: env.ACCOUNT_INTEL_AUTO_REFRESH === 'true', financialsScan }, 'account intel worker started');
}

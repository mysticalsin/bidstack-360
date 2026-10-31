/**
 * account-enrichment queue worker. Job names:
 *   account-enrichment.enrich  refresh one company (see account-enrichment/job.ts)
 *   account-enrichment.sweep   repeatable (daily), only when ENRICHMENT_AUTO_REFRESH=true:
 *                              enqueue expired key accounts, capped by ENRICHMENT_SWEEP_LIMIT
 *   account-enrichment.orgchart-seed  seed one account's org chart (admin request only,
 *                              see org-chart/seed.ts); never swept
 */
import { type Job, Queue, Worker } from 'bullmq';
import type IORedis from 'ioredis';
import type pino from 'pino';

import { ACCOUNT_ENRICHMENT, type AccountEnrichmentJob } from '@bidstack/shared';

import {
  defaultEnrichmentDeps,
  dueCompanies,
  EnrichmentRateLimitedError,
  runAccountEnrichment,
} from '../account-enrichment/job.js';
import { runOrgChartSeed } from '../org-chart/seed.js';

const SWEEP_EVERY_MS = 24 * 60 * 60_000;

export function enrichJobId(orgId: string, companyId: string): string {
  return `${orgId}--enrich--${companyId}`;
}

export async function startAccountEnrichment(
  connection: IORedis,
  log: pino.Logger,
  workers: Worker[],
  queues: Queue[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const queue = new Queue(ACCOUNT_ENRICHMENT.name, { connection, defaultJobOptions: ACCOUNT_ENRICHMENT.defaultJobOptions });
  queues.push(queue);
  const deps = defaultEnrichmentDeps(env);
  const worker = new Worker<AccountEnrichmentJob>(
    ACCOUNT_ENRICHMENT.name,
    async (job: Job<AccountEnrichmentJob>) => {
      const data = job.data;
      if (data.kind === 'sweep') {
        const limit = Number(env.ENRICHMENT_SWEEP_LIMIT ?? 50) || 50;
        const due = await dueCompanies(limit, new Date());
        for (const d of due) {
          await queue.add('account-enrichment.enrich', { kind: 'enrich', ...d }, { jobId: enrichJobId(d.orgId, d.companyId) });
        }
        return { enqueued: due.length };
      }
      if (data.kind === 'orgchart_seed') {
        const res = await runOrgChartSeed(data, deps);
        log.info({ jobId: job.id, orgId: data.orgId, companyId: data.companyId, ...res }, 'org chart seed finished');
        return res;
      }
      try {
        const res = await runAccountEnrichment(data, deps);
        log.info({ jobId: job.id, orgId: data.orgId, companyId: data.companyId, ...res }, 'account enrichment finished');
        return res;
      } catch (err) {
        if (err instanceof EnrichmentRateLimitedError && err.retryAfterMs) {
          log.warn({ jobId: job.id, retryAfterMs: err.retryAfterMs }, 'account enrichment rate limited');
        }
        throw err;
      }
    },
    // Low concurrency keeps us well under Apollo and Seamless per-minute limits.
    { connection, concurrency: 2, limiter: { max: 30, duration: 60_000 } },
  );
  worker.on('failed', (job, err) => {
    log.warn({ jobId: job?.id, err: err.message }, 'account enrichment job failed');
  });
  workers.push(worker);
  if (env.ENRICHMENT_AUTO_REFRESH === 'true') {
    await queue.add('account-enrichment.sweep', { kind: 'sweep' }, { repeat: { every: SWEEP_EVERY_MS }, jobId: 'account-enrichment-sweep' });
  }
  log.info(
    {
      queue: ACCOUNT_ENRICHMENT.name,
      providers: deps.providers.map((p) => ({ id: p.id, configured: p.configured() })),
      autoRefresh: env.ENRICHMENT_AUTO_REFRESH === 'true',
    },
    'account enrichment worker started',
  );
}

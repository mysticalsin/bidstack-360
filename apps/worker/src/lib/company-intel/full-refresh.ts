/**
 * Company intel full refresh (slice 14): one job per company, from the manual
 * Refresh button or from an import.
 *
 * 1. Public sources (job boards, company posts, filings, registries) through
 *    the slice 12 runner: contact User-Agent, robots.txt, cache, per-host gap.
 * 2. Apollo ORGANIZATION data only (organizations/enrich by domain), inside the
 *    monthly credit budget, skipped when APOLLO_API_KEY is unset. Job pages are
 *    off here, and no people, contact or person endpoint is ever called.
 * 3. Rebuild the list summary, then record the company on its import batch.
 */
import {
  intelConnections,
  markImportBatchCompany,
  prisma,
  recomputeCompanyIntelSummary,
} from '@bidstack/db';
import {
  accountEnrichmentConfigFromEnv,
  type AccountIntelQueueJob,
  IntelSourceKey,
} from '@bidstack/shared';

import {
  EnrichmentRateLimitedError,
  runAccountEnrichment,
  type EnrichmentDeps,
} from '../../account-enrichment/job.js';
import { createApolloProvider, type FetchLike } from '../../account-enrichment/providers.js';
import { defaultIntelFetch, type IntelFetch } from '../account-intel/http.js';
import { prismaIntelStore } from '../account-intel/prisma-store.js';
import { runAccountIntel, type IntelRunDeps, type IntelStore } from '../account-intel/run.js';

/** The full-refresh job on the account-intel queue. */
export type FullRefreshQueueJob = Extract<AccountIntelQueueJob, { kind: 'full-refresh' }>;

/** Imports skip public sources read this recently; a manual Refresh always reads. */
const FRESH_MS = 24 * 60 * 60_000;

export interface FullRefreshDeps {
  env: Record<string, string | undefined>;
  now: () => Date;
  intel: Omit<IntelRunDeps, 'now'>;
  /** Null when APOLLO_API_KEY is unset. */
  apollo: EnrichmentDeps | null;
}

/** Production dependencies; tests swap the fetchers, clock and financials. */
export function fullRefreshDeps(opts: {
  env: Record<string, string | undefined>;
  intelFetch?: IntelFetch;
  apolloFetch?: FetchLike;
  financials: IntelRunDeps['financials'];
  store?: IntelStore;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}): FullRefreshDeps {
  const now = opts.now ?? (() => new Date());
  const apolloProvider = createApolloProvider({
    env: opts.env,
    ...(opts.apolloFetch ? { fetchImpl: opts.apolloFetch } : {}),
  });
  return {
    env: opts.env,
    now,
    intel: {
      store: opts.store ?? prismaIntelStore(),
      env: opts.env,
      fetchImpl: opts.intelFetch ?? defaultIntelFetch(),
      financials: opts.financials,
      ...(opts.sleep ? { sleep: opts.sleep } : {}),
    },
    apollo: apolloProvider.configured()
      ? {
          providers: [apolloProvider],
          config: { ...accountEnrichmentConfigFromEnv(opts.env), maxJobPages: 0 },
          now,
          projectLlm: async () => null,
        }
      : null,
  };
}

export interface FullRefreshResult {
  intel: Record<string, string>;
  apollo: string;
  summary: boolean;
}

/** Bulk imports never spend paid job-aggregator calls; a manual Refresh still can. */
function withoutPaidAggregator(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const { ACCOUNT_INTEL_JOB_AGGREGATOR: _omit, ...rest } = env;
  return rest;
}

async function publicSourcesFresh(orgId: string, companyId: string, now: Date): Promise<boolean> {
  const run = await prisma.intelSourceRun.findFirst({
    where: {
      orgId,
      companyId,
      source: 'hiring',
      lastFetchedAt: { gte: new Date(now.getTime() - FRESH_MS) },
    },
    select: { id: true },
  });
  return Boolean(run);
}

/** Refresh one company end to end. `finalAttempt` false lets a retry settle the batch instead. */
export async function runCompanyFullRefresh(
  job: FullRefreshQueueJob,
  deps: FullRefreshDeps,
  opts: { finalAttempt?: boolean } = {},
): Promise<FullRefreshResult> {
  const now = deps.now();
  try {
    const intel: Record<string, string> = {};
    if (job.force || !(await publicSourcesFresh(job.orgId, job.companyId, now))) {
      const env = job.batchId ? withoutPaidAggregator(deps.intel.env) : deps.intel.env;
      const res = await runAccountIntel(
        { orgId: job.orgId, companyId: job.companyId, sources: [...IntelSourceKey.options] },
        { ...deps.intel, env, now },
      );
      for (const [k, v] of Object.entries(res)) if (v) intel[k] = v.status;
    } else {
      intel.skipped = 'fresh';
    }

    let apollo = 'not_configured';
    let retryLater: EnrichmentRateLimitedError | null = null;
    if (deps.apollo) {
      try {
        const r = await runAccountEnrichment(
          {
            orgId: job.orgId,
            companyId: job.companyId,
            force: false,
            requestedById: job.requestedBy ?? null,
          },
          deps.apollo,
        );
        apollo = r.status ?? r.outcome;
      } catch (err) {
        if (!(err instanceof EnrichmentRateLimitedError)) throw err;
        apollo = 'rate_limited';
        // A queued attempt with retries left rethrows after saving the public
        // data, so the queue fetches Apollo again; the last attempt settles.
        if (opts.finalAttempt === false) retryLater = err;
      }
    }

    const summary = await recomputeCompanyIntelSummary(prisma, job.orgId, job.companyId, {
      now,
      connections: intelConnections(deps.env),
    });
    if (retryLater) throw retryLater;
    if (job.batchId)
      await markImportBatchCompany(prisma, {
        orgId: job.orgId,
        batchId: job.batchId,
        companyId: job.companyId,
        ok: true,
        now,
      });
    return { intel, apollo, summary: Boolean(summary) };
  } catch (err) {
    if (job.batchId && opts.finalAttempt !== false) {
      await markImportBatchCompany(prisma, {
        orgId: job.orgId,
        batchId: job.batchId,
        companyId: job.companyId,
        ok: false,
        now,
      }).catch(() => undefined);
    }
    throw err;
  }
}

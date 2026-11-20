/**
 * company-tech-detect queue worker (slice 16). Job names:
 *   company-tech-detect.refresh  open data technology stack for one account
 *                                (company create, import, or the weekly sweep)
 *   company-tech-detect.sweep    repeatable weekly: queue every account whose
 *                                stack was not checked in the last 7 days, in
 *                                batches, one account at a time
 *
 * Public sources only: DNS, certificate transparency, the homepage (robots.txt
 * respected), stored public job postings and public GitHub repositories. Apollo
 * organization enrichment is queued only when open data finds fewer than the
 * fallback threshold and an Apollo key is configured.
 */
import { prisma, refreshCompanyOpenTechStack, type OpenTechApolloJob } from '@bidstack/db';
import { COMPANY_ENRICH_APOLLO, COMPANY_TECH_DETECT, parseOpenTechSnapshot, type CompanyTechDetectQueueJob } from '@bidstack/shared';
import { type Job, Queue, Worker } from 'bullmq';
import type IORedis from 'ioredis';
import type pino from 'pino';

import { createApolloEnrichJobSignature } from './company-enrich-apollo.js';

const DAY_MS = 24 * 60 * 60_000;
const WEEK_MS = 7 * DAY_MS;
const SWEEP_PAGE = 200;

let detectQueue: Queue | null = null;

/** One sweep job per account and ISO week, so a restarted sweep never doubles up. */
export function techSweepJobId(orgId: string, companyId: string, at: Date = new Date()): string {
  return `${orgId}--tech--${companyId}--w${Math.floor(at.getTime() / WEEK_MS)}`;
}

export function techRefreshJobId(orgId: string, companyId: string, at: Date = new Date()): string {
  return `${orgId}--tech--${companyId}--${Math.floor(at.getTime() / 3_600_000)}`;
}

/** Imports call this per created company. A no-op until the worker has started. */
export function queueTechDetectAfterImport(orgId: string, companyId: string): void {
  if (!detectQueue || process.env.BIDSTACK_OPEN_ENRICHMENT_DISABLED === '1') return;
  void detectQueue
    .add('company-tech-detect.refresh', { kind: 'refresh', orgId, companyId, reason: 'import' }, { jobId: techRefreshJobId(orgId, companyId) })
    .catch(() => undefined);
}

/** True when the stored snapshot is missing, sample data, or older than the cutoff. */
export function techStackStale(providerMetadata: unknown, cutoff: Date): boolean {
  const metadata = (providerMetadata ?? {}) as Record<string, unknown>;
  const snapshot = parseOpenTechSnapshot(metadata.openTechStack);
  if (!snapshot || snapshot.sample) return true;
  return new Date(snapshot.checkedAt).getTime() < cutoff.getTime();
}

/** Sweep order key: real check time in ms, 0 when never checked or only sample data. */
function techStackCheckedMs(providerMetadata: unknown): number {
  const metadata = (providerMetadata ?? {}) as Record<string, unknown>;
  const snapshot = parseOpenTechSnapshot(metadata.openTechStack);
  if (!snapshot || snapshot.sample) return 0;
  const ms = new Date(snapshot.checkedAt).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function normalized(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export async function sweepTechStacks(queue: Pick<Queue, 'add'>, env: NodeJS.ProcessEnv, log: pino.Logger, now = new Date()): Promise<{ enqueued: number }> {
  const limit = Number(env.TECH_STACK_SWEEP_LIMIT ?? 500) || 500;
  const cutoff = new Date(now.getTime() - WEEK_MS + DAY_MS / 2);
  const orgs: Array<{ id: string }> = [];
  for (let cursor: string | undefined; ; ) {
    const page = await prisma.org.findMany({ select: { id: true }, orderBy: { id: 'asc' }, take: 500, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    orgs.push(...page);
    if (page.length < 500) break;
    cursor = page[page.length - 1]!.id;
  }
  // The cap applies after ordering by last check, oldest first, so a backlog
  // larger than the cap rotates through every account across weekly runs.
  const stale: Array<{ orgId: string; companyId: string; checkedMs: number }> = [];
  for (const org of orgs) {
    for (let cursor: string | undefined; ; ) {
      const page = await prisma.company.findMany({
        where: { orgId: org.id, deletedAt: null, OR: [{ domain: { not: null } }, { website: { not: null } }] },
        select: { id: true, name: true },
        orderBy: { id: 'asc' },
        take: SWEEP_PAGE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (page.length === 0) break;
      const enrichments = await prisma.companyEnrichment.findMany({
        where: { orgId: org.id, deletedAt: null, normalizedName: { in: page.map((c) => normalized(c.name)) } },
        select: { normalizedName: true, providerMetadata: true },
      });
      const metadataByName = new Map(enrichments.map((e) => [e.normalizedName, e.providerMetadata]));
      for (const company of page) {
        const metadata = metadataByName.get(normalized(company.name));
        if (!techStackStale(metadata, cutoff)) continue;
        stale.push({ orgId: org.id, companyId: company.id, checkedMs: techStackCheckedMs(metadata) });
      }
      if (page.length < SWEEP_PAGE) break;
      cursor = page[page.length - 1]!.id;
    }
  }
  stale.sort((a, b) => a.checkedMs - b.checkedMs);
  let enqueued = 0;
  for (const { orgId, companyId } of stale.slice(0, limit)) {
    await queue.add('company-tech-detect.refresh', { kind: 'refresh', orgId, companyId, reason: 'sweep' }, { jobId: techSweepJobId(orgId, companyId, now) });
    enqueued++;
  }
  log.info({ enqueued, limit }, 'tech stack sweep queued accounts');
  return { enqueued };
}

function signingSecret(): string | null {
  return process.env.BIDSTACK_JOB_SIGNING_SECRET ?? process.env.JOB_SIGNING_SECRET ?? null;
}

/** Start the company-tech-detect worker and its weekly sweep. */
export async function startCompanyTechDetect(connection: IORedis, log: pino.Logger, workers: Worker[], queues: Queue[], env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const queue = new Queue(COMPANY_TECH_DETECT.name, { connection, defaultJobOptions: COMPANY_TECH_DETECT.defaultJobOptions });
  const apolloQueue = new Queue(COMPANY_ENRICH_APOLLO.name, { connection, defaultJobOptions: COMPANY_ENRICH_APOLLO.defaultJobOptions });
  queues.push(queue, apolloQueue);
  detectQueue = queue;

  const enqueueApollo = async (job: OpenTechApolloJob): Promise<string | null> => {
    const secret = signingSecret();
    if (!secret && env.NODE_ENV === 'production') return null;
    const payload = secret ? { ...job, signature: createApolloEnrichJobSignature(job, secret) } : job;
    const queued = await apolloQueue.add('apollo.enrich', payload, { jobId: `${job.orgId}_${job.companyName.replace(/[^a-zA-Z0-9_-]/g, '_')}` });
    return queued.id ?? null;
  };

  const worker = new Worker<CompanyTechDetectQueueJob>(
    COMPANY_TECH_DETECT.name,
    async (job: Job<CompanyTechDetectQueueJob>) => {
      const data = job.data;
      if (data.kind === 'sweep') return sweepTechStacks(queue, env, log);
      const company = await prisma.company.findFirst({
        where: { id: data.companyId, orgId: data.orgId, deletedAt: null },
        select: { name: true, domain: true, website: true },
      });
      if (!company) return { skipped: 'company not found' };
      const res = await refreshCompanyOpenTechStack({
        prisma,
        orgId: data.orgId,
        companyName: company.name,
        domain: company.domain,
        website: company.website,
        log: log.child({ queue: COMPANY_TECH_DETECT.name, jobId: job.id }),
        enqueueApollo,
        createIfMissing: true,
        laneTimeoutMs: 20_000,
        env,
      });
      return { reason: data.reason, openItems: res.coverage.openItems, apolloFallback: res.apolloFallback };
    },
    // One account at a time keeps DNS, crt.sh and GitHub well inside their polite rates.
    { connection, concurrency: 1, limiter: { max: 10, duration: 60_000 } },
  );
  worker.on('failed', (job, err) => {
    log.warn({ jobId: job?.id, err: err.message }, 'tech stack job failed');
  });
  workers.push(worker);

  const sweepOn = env.TECH_STACK_WEEKLY_REFRESH !== 'false' && env.BIDSTACK_OPEN_ENRICHMENT_DISABLED !== '1';
  if (sweepOn) {
    await queue.add('company-tech-detect.sweep', { kind: 'sweep' }, { repeat: { every: WEEK_MS }, jobId: 'company-tech-detect-sweep' });
  }
  log.info({ queue: COMPANY_TECH_DETECT.name, weeklySweep: sweepOn }, 'tech stack worker started');
}

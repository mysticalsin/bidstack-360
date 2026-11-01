/**
 * Account watchdog worker (financial public-filing monitor).
 *
 * Queue: account.watchdog. One repeatable scan (every 6 h) walks enabled,
 * identifier-confirmed AccountWatchSubjects, oldest-checked first, and for each one runs the
 * configured source adapters (SEC EDGAR when secCik + SEC_USER_AGENT are set,
 * Companies House when companiesHouseNumber + COMPANIES_HOUSE_API_KEY are set).
 * Events persist idempotently on (orgId, source, externalId); only events that
 * are new this scan, at severity >= WATCHDOG_MIN_ALERT_SEVERITY (default 3),
 * become in-app notifications for the key-account owner and the owners of the
 * account's open opportunities. A source that is not configured or fails is
 * recorded in lastError: the watch is never reported healthy when it isn't.
 *
 * No outbound call happens unless a source is configured for that subject.
 * Secrets (the Companies House key) are read from env and never logged.
 */
import { Queue, Worker, type Job } from 'bullmq';
import type IORedis from 'ioredis';
import type pino from 'pino';

import { prisma, OpportunityStage, type Prisma } from '@bidstack/db';
import { enrichmentWatchRows, importanceScore } from '@bidstack/shared';

import { fetchCompaniesHouseEvents } from '../lib/watchdog/companies-house.js';
import { detectAccountEvents, type DetectResult, type WatchdogStore } from '../lib/watchdog/detect.js';
import { fetchEdgarEvents, type FetchLike, type RawWatchEvent } from '../lib/watchdog/edgar.js';
import { redisNewsCache } from '../lib/watchdog/news.js';
import { runNewsScan } from '../lib/watchdog/news-scan.js';

export const WATCHDOG_QUEUE = 'account.watchdog';
const SCAN_EVERY_MS = 6 * 60 * 60_000;
/** A subject checked more recently than this is skipped (restart / manual run safety). */
const MIN_RECHECK_MS = 3 * 60 * 60_000;
const SCAN_BATCH = 200;
/** SEC fair access is <= 10 req/s; Companies House is 600 per 5 min. One subject per 250 ms keeps both far below. */
const PACE_MS = 250;

const JOB_OPTIONS = {
  attempts: 2,
  backoff: { type: 'fixed' as const, delay: 60_000 },
  removeOnComplete: { age: 86_400, count: 50 },
  removeOnFail: { age: 86_400 * 7, count: 200 },
};

type Db = Pick<typeof prisma, 'accountWatchSubject' | 'accountWatchEvent' | 'notification' | 'opportunity' | 'companyFirmographics'>;

export interface WatchdogScanDeps {
  db?: Db;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: FetchLike;
  now?: Date;
  sleep?: (ms: number) => Promise<void>;
  log?: Pick<pino.Logger, 'info' | 'warn' | 'error'>;
  /** Restrict to one org (used by tests and a future "check now" endpoint). */
  orgId?: string;
}

export interface WatchdogScanSummary {
  subjects: number;
  inserted: number;
  alerted: number;
  errored: number;
  /** New enrichment (potential project) signals this scan. */
  enrichment: number;
}

const ENRICHMENT_SYNC_BATCH = 1000;
/** Re-read firmographics enriched in the last week (wider than the scan interval, so nothing is missed). */
const ENRICHMENT_LOOKBACK_MS = 7 * 86_400_000;

/**
 * Potential projects (account enrichment) as watch events, org-wide. Same rows
 * and rules as GET /enrichment/signals (medium+), read straight from
 * company_firmographics: the worker has no user session to call the API with,
 * and per-user scoping happens when the events are read. Insert only, so a
 * dismissed signal stays dismissed. No notifications: these are severity 1–2,
 * below the alert threshold.
 */
export async function syncEnrichmentSignals(db: Db, opts: { now: Date; orgId?: string }): Promise<number> {
  const rows = await db.companyFirmographics.findMany({
    where: {
      ...(opts.orgId ? { orgId: opts.orgId } : {}),
      fetchedAt: { gte: new Date(opts.now.getTime() - ENRICHMENT_LOOKBACK_MS) },
      company: { deletedAt: null },
    },
    select: { orgId: true, companyId: true, projects: true, fetchedAt: true },
    orderBy: { fetchedAt: 'desc' },
    take: ENRICHMENT_SYNC_BATCH,
  });
  const store = prismaWatchdogStore(db);
  let inserted = 0;
  for (const r of rows) {
    const events = enrichmentWatchRows(r).map((e) => ({ ...e, severity: (e.severity === 2 ? 2 : 1) as 1 | 2, payload: { ...e.payload } }));
    if (!events.length) continue;
    inserted += (await store.insertEvents(events)).length;
  }
  return inserted;
}

export function prismaWatchdogStore(db: Db): WatchdogStore {
  return {
    async insertEvents(rows) {
      if (!rows.length) return [];
      const orgId = rows[0]!.orgId;
      const existing = await db.accountWatchEvent.findMany({
        where: { orgId, OR: rows.map((r) => ({ source: r.source, externalId: r.externalId })) },
        select: { source: true, externalId: true },
      });
      const seen = new Set(existing.map((e) => `${e.source}|${e.externalId}`));
      const fresh: typeof rows = [];
      for (const r of rows) {
        const k = `${r.source}|${r.externalId}`;
        if (seen.has(k)) continue;
        seen.add(k);
        fresh.push(r);
      }
      if (!fresh.length) return [];
      await db.accountWatchEvent.createMany({
        skipDuplicates: true,
        data: fresh.map((r) => ({
          orgId: r.orgId,
          companyId: r.companyId,
          source: r.source,
          externalId: r.externalId,
          kind: r.kind,
          occurredAt: r.occurredAt,
          title: r.title,
          sourceUrl: r.sourceUrl,
          summary: r.summary,
          implication: r.implication,
          implicationRationale: r.rationale,
          severity: r.severity,
          // v21: 0..100 importance on every new row (filings, enrichment), so the
          // portfolio alerts and account feed rank all sources on one scale.
          importance: importanceScore({ kind: r.kind, implication: r.implication, source: r.source }),
          confirmed: r.confirmed,
          payload: r.payload as Prisma.InputJsonValue,
        })),
      });
      return fresh as RawWatchEvent[];
    },
    async notify({ orgId, userIds, companyId, title, body, url }) {
      if (!userIds.length) return;
      await db.notification.createMany({
        data: userIds.map((userId) => ({ orgId, userId, type: 'system', title, body, url, entityType: 'company', entityId: companyId })),
      });
    },
    async markChecked(subjectId, at, error) {
      await db.accountWatchSubject.update({ where: { id: subjectId }, data: { lastCheckedAt: at, lastError: error } });
    },
  };
}

/** Key-account owner + owners of open opportunities on the account, de-duplicated. */
async function alertRecipients(db: Db, orgId: string, companyId: string, kamOwnerId: string | null): Promise<string[]> {
  const opps = await db.opportunity.findMany({
    where: {
      orgId,
      companyId,
      deletedAt: null,
      ownerId: { not: null },
      stage: { notIn: [OpportunityStage.closed_won, OpportunityStage.closed_lost] },
    },
    select: { ownerId: true },
    take: 50,
  });
  const ids = new Set<string>();
  if (kamOwnerId) ids.add(kamOwnerId);
  for (const o of opps) if (o.ownerId) ids.add(o.ownerId);
  return [...ids];
}

export async function runWatchdogScan(deps: WatchdogScanDeps = {}): Promise<WatchdogScanSummary> {
  const db = deps.db ?? prisma;
  const env = deps.env ?? process.env;
  const now = deps.now ?? new Date();
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const minAlertSeverity = Number(env.WATCHDOG_MIN_ALERT_SEVERITY ?? 3) || 3;
  const secUserAgent = env.SEC_USER_AGENT ?? '';
  const chKey = env.COMPANIES_HOUSE_API_KEY ?? '';
  const store = prismaWatchdogStore(db);

  const subjects = await db.accountWatchSubject.findMany({
    where: {
      enabled: true,
      // Monitoring starts only after a human confirmed the identifiers map to
      // this account (the API reports enabled=false until then, too).
      identifiersConfirmedAt: { not: null },
      ...(deps.orgId ? { orgId: deps.orgId } : {}),
      OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lt: new Date(now.getTime() - MIN_RECHECK_MS) } }],
    },
    orderBy: [{ lastCheckedAt: { sort: 'asc', nulls: 'first' } }, { id: 'asc' }],
    take: SCAN_BATCH,
    select: {
      id: true, orgId: true, companyId: true, secCik: true, companiesHouseNumber: true, lastCheckedAt: true,
      company: { select: { name: true, keyAccountOwnerId: true } },
    },
  });

  const summary: WatchdogScanSummary = { subjects: subjects.length, inserted: 0, alerted: 0, errored: 0, enrichment: 0 };
  try {
    summary.enrichment = await syncEnrichmentSignals(db, { now, orgId: deps.orgId });
  } catch (err) {
    deps.log?.error({ err: err instanceof Error ? err.message : String(err) }, 'watchdog enrichment sync failed');
    summary.errored++;
  }
  for (const [i, s] of subjects.entries()) {
    if (i > 0) await sleep(PACE_MS);
    const adapters: Array<(since: Date | undefined) => Promise<RawWatchEvent[]>> = [];
    const notConfigured: string[] = [];
    if (s.secCik) {
      if (secUserAgent) adapters.push((since) => fetchEdgarEvents(s.secCik!, { since, userAgent: secUserAgent, fetchImpl: deps.fetchImpl }));
      else notConfigured.push('SEC EDGAR not configured (SEC_USER_AGENT)');
    }
    if (s.companiesHouseNumber) {
      if (chKey) adapters.push((since) => fetchCompaniesHouseEvents(s.companiesHouseNumber!, s.company.name, { apiKey: chKey, since, fetchImpl: deps.fetchImpl }));
      else notConfigured.push('Companies House not configured (COMPANIES_HOUSE_API_KEY)');
    }
    if (!s.secCik && !s.companiesHouseNumber) notConfigured.push('No public-filing identifier on this account');
    let res: DetectResult;
    try {
      const alertUserIds = await alertRecipients(db, s.orgId, s.companyId, s.company.keyAccountOwnerId);
      res = await detectAccountEvents(
        { id: s.id, orgId: s.orgId, companyId: s.companyId, lastCheckedAt: s.lastCheckedAt, alertUserIds },
        adapters,
        store,
        { now, minAlertSeverity },
      );
      if (notConfigured.length) {
        const error = [res.error, ...notConfigured].filter(Boolean).join('; ');
        await store.markChecked(s.id, now, error);
        res = { ...res, error };
      }
    } catch (err) {
      // Per-subject isolation: one bad row never aborts the scan.
      const msg = err instanceof Error ? err.message : String(err);
      deps.log?.error({ subjectId: s.id, err: msg }, 'watchdog subject failed');
      await store.markChecked(s.id, now, msg).catch(() => undefined);
      summary.errored++;
      continue;
    }
    summary.inserted += res.inserted;
    summary.alerted += res.alerted;
    if (res.error) summary.errored++;
  }
  deps.log?.info(summary, 'account watchdog scan complete');
  return summary;
}

export async function startAccountWatchdog(
  connection: IORedis,
  log: pino.Logger,
  workers: Worker[],
  queues: Queue[],
): Promise<void> {
  if (process.env.WATCHDOG_ENABLED === 'false') {
    log.info({ queue: WATCHDOG_QUEUE }, 'account watchdog disabled (WATCHDOG_ENABLED=false)');
    return;
  }
  const queue = new Queue(WATCHDOG_QUEUE, { connection, defaultJobOptions: JOB_OPTIONS });
  queues.push(queue);
  const child = log.child({ worker: WATCHDOG_QUEUE });
  const newsCache = redisNewsCache(connection);
  const worker = new Worker(
    WATCHDOG_QUEUE,
    async (_job: Job) => {
      const filings = await runWatchdogScan({ log: child });
      // News watchdog (v21): no-op unless WATCHDOG_NEWS_SOURCES is set. A news
      // failure never fails the filings scan.
      const news = await runNewsScan({ log: child, cache: newsCache }).catch((err: unknown) => {
        child.error({ err: err instanceof Error ? err.message : String(err) }, 'news watchdog scan failed');
        return null;
      });
      if (news?.enabled) child.info(news, 'news watchdog scan complete');
      return { ...filings, news };
    },
    { connection, concurrency: 1 },
  );
  worker.on('failed', (job, err) => log.warn({ jobId: job?.id, err: err.message }, 'account watchdog scan failed'));
  workers.push(worker);
  // Idempotent jobId: restarts never stack duplicate repeatables.
  await queue.add('account-watchdog-scan', {}, { repeat: { every: SCAN_EVERY_MS }, jobId: 'account-watchdog-scan' });
  log.info({ queue: WATCHDOG_QUEUE, everyHours: SCAN_EVERY_MS / 3_600_000 }, 'account watchdog started (repeatable scan registered)');
}

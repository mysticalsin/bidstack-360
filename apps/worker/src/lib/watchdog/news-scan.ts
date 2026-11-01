/**
 * Org-wide news scan for the account watchdog (v21). Called from the
 * account.watchdog repeatable job after the filing scan. Does nothing unless
 * WATCHDOG_NEWS_SOURCES (or the Apify LinkedIn flag) is set.
 *
 * Accounts scanned: monitored subjects plus accounts with open opportunities
 * or a key-account owner, oldest-scanned first, capped per run
 * (WATCHDOG_NEWS_MAX_ACCOUNTS, default 40) and paced 5 s apart for GDELT.
 */
import { prisma, type Prisma } from '@bidstack/db';

import {
  memoryNewsCache,
  newsConfigFromEnv,
  runAccountNews,
  type NewsCache,
  type NewsFetch,
  type NewsRow,
  type NewsStore,
  type NewsSubject,
} from './news.js';
import { hasNewsIdentifiers, usableIdentifiers, type BodyFetch } from './news-verify.js';

type Db = Pick<typeof prisma, 'accountWatchEvent' | 'notification' | 'company' | 'companyFirmographics' | 'opportunity' | 'accountWatchSubject'>;

export interface NewsScanDeps {
  db?: Db;
  env?: Record<string, string | undefined>;
  fetchImpl?: NewsFetch;
  cache?: NewsCache;
  now?: Date;
  sleep?: (ms: number) => Promise<void>;
  bodyFetch?: BodyFetch;
  log?: { info(o: object, m?: string): void; warn(o: object, m?: string): void };
  orgId?: string;
}

export interface NewsScanSummary {
  enabled: boolean;
  accounts: number;
  inserted: number;
  merged: number;
  alerted: number;
  errored: number;
  /** v22: accounts with no website or ticker (no news, UI shows a hint). */
  skippedNoIdentifiers: number;
  dropped: number;
  /** v22.1: GDELT state for this run (backoff carries across runs in the cache). */
  gdelt: { state: 'off' | 'backoff' | 'ok' | 'rate_limited' | 'unused'; level: number; until: string | null };
  perAccount: Array<{ companyId: string; name: string; fetched: number; kept: number; inserted: number; dropped: number; skipped?: string }>;
}

const PACE_MS = 5_000;
// GDELT asks for at most one call per 5 s per client; stay well under it.
const GDELT_PACE_MS = 10_000;
export const GDELT_BACKOFF_KEY = 'gdelt:backoff';
const HOUR = 3_600_000;

/** After the n-th consecutive rate-limited run, wait 1 h, 2 h, 4 h ... up to 24 h. */
export function gdeltBackoffMs(level: number): number {
  return Math.min(24 * HOUR, HOUR * 2 ** Math.max(0, level - 1));
}

interface GdeltBackoff {
  level: number;
  until: number;
}

async function readBackoff(cache: NewsCache): Promise<GdeltBackoff> {
  try {
    const raw = await cache.get(GDELT_BACKOFF_KEY);
    const v = raw ? (JSON.parse(raw) as Partial<GdeltBackoff>) : {};
    return { level: Number(v.level) || 0, until: Number(v.until) || 0 };
  } catch {
    return { level: 0, until: 0 };
  }
}
const OPEN_STAGES_EXCLUDED = ['closed_won', 'closed_lost'] as const;

export function prismaNewsStore(db: Db): NewsStore {
  return {
    async findByDedupeKeys(orgId, companyId, keys, since) {
      if (!keys.length) return [];
      const rows = await db.accountWatchEvent.findMany({
        where: { orgId, companyId, dedupeKey: { in: keys }, occurredAt: { gte: since } },
        select: { id: true, dedupeKey: true, mentions: true, kind: true, implication: true, source: true },
        take: 200,
      });
      return rows.map((r) => ({ ...r, dedupeKey: r.dedupeKey ?? '' }));
    },
    async insert(rows: NewsRow[]) {
      if (!rows.length) return [];
      const orgId = rows[0]!.orgId;
      const existing = await db.accountWatchEvent.findMany({
        where: { orgId, OR: rows.map((r) => ({ source: r.source, externalId: r.externalId })) },
        select: { source: true, externalId: true },
      });
      const seen = new Set(existing.map((e) => `${e.source}|${e.externalId}`));
      const fresh = rows.filter((r) => {
        const k = `${r.source}|${r.externalId}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
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
          confirmed: r.confirmed,
          importance: r.importance,
          sentiment: r.sentiment,
          dedupeKey: r.dedupeKey,
          mentions: r.mentions,
          payload: r.payload as Prisma.InputJsonValue,
        })),
      });
      return fresh;
    },
    async bump(id, mentions, importance) {
      await db.accountWatchEvent.update({ where: { id }, data: { mentions, importance } });
    },
    async notify({ orgId, userIds, companyId, title, body, url }) {
      if (!userIds.length) return;
      await db.notification.createMany({
        data: userIds.map((userId) => ({ orgId, userId, type: 'system', title, body, url, entityType: 'company', entityId: companyId })),
      });
    },
  };
}

function linkedinFrom(providerIds: unknown): string | null {
  if (!providerIds || typeof providerIds !== 'object') return null;
  const v = (providerIds as Record<string, unknown>).linkedin_url;
  return typeof v === 'string' && /^https:\/\/(www\.)?linkedin\.com\/company\//.test(v) ? v : null;
}

export async function runNewsScan(deps: NewsScanDeps = {}): Promise<NewsScanSummary> {
  const db = deps.db ?? prisma;
  const env = deps.env ?? process.env;
  const config = newsConfigFromEnv(env);
  const summary: NewsScanSummary = { enabled: config.sources.length > 0, accounts: 0, inserted: 0, merged: 0, alerted: 0, errored: 0, skippedNoIdentifiers: 0, dropped: 0, gdelt: { state: 'off', level: 0, until: null }, perAccount: [] };
  if (!summary.enabled) return summary;
  const now = deps.now ?? new Date();
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const max = Math.max(1, Math.min(200, Number.parseInt(env.WATCHDOG_NEWS_MAX_ACCOUNTS ?? '', 10) || 40));
  const companies = await db.company.findMany({
    where: {
      deletedAt: null,
      ...(deps.orgId ? { orgId: deps.orgId } : {}),
      OR: [
        { keyAccountOwnerId: { not: null } },
        { opportunities: { some: { deletedAt: null, stage: { notIn: [...OPEN_STAGES_EXCLUDED] } } } },
        { accountWatchSubjects: { some: { enabled: true } } },
      ],
    },
    select: {
      id: true,
      orgId: true,
      name: true,
      domain: true,
      keyAccountOwnerId: true,
      accountWatchSubjects: { select: { irFeedUrl: true, ticker: true, exchange: true, identifiersConfirmedAt: true }, take: 1 },
      firmographics: { select: { providerIds: true } },
    },
    orderBy: { name: 'asc' },
    take: max,
  });
  const store = prismaNewsStore(db);
  const cache = deps.cache ?? memoryNewsCache();
  const fetchImpl = deps.fetchImpl ?? (fetch as unknown as NewsFetch);
  const bodyFetch = deps.bodyFetch ?? (deps.fetchImpl ? undefined : (fetch as unknown as BodyFetch));
  let paced = false;
  let cfg = config;
  const backoff = config.sources.includes('gdelt') ? await readBackoff(cache) : { level: 0, until: 0 };
  summary.gdelt = { state: config.sources.includes('gdelt') ? 'unused' : 'off', level: backoff.level, until: backoff.until ? new Date(backoff.until).toISOString() : null };
  if (config.sources.includes('gdelt') && backoff.until > now.getTime()) {
    cfg = { ...cfg, sources: cfg.sources.filter((x) => x !== 'gdelt') };
    summary.gdelt.state = 'backoff';
    deps.log?.info({ until: summary.gdelt.until, level: backoff.level }, 'gdelt backing off after rate limits');
  }
  for (const c of companies) {
    const ws = c.accountWatchSubjects[0];
    // Tickers count only once a person confirmed them (same rule as filings).
    const ticker = ws?.identifiersConfirmedAt ? (ws.ticker ?? null) : null;
    const exchange = ws?.identifiersConfirmedAt ? (ws.exchange ?? null) : null;
    if (!hasNewsIdentifiers(usableIdentifiers({ domain: c.domain, ticker, exchange, companyName: c.name }))) {
      summary.skippedNoIdentifiers++;
      summary.perAccount.push({ companyId: c.id, name: c.name, fetched: 0, kept: 0, inserted: 0, dropped: 0, skipped: 'no_identifiers' });
      continue;
    }
    if (paced) await sleep(cfg.sources.includes('gdelt') ? GDELT_PACE_MS : PACE_MS);
    paced = true;
    const opps = await db.opportunity.findMany({
      where: { orgId: c.orgId, companyId: c.id, deletedAt: null, ownerId: { not: null }, stage: { notIn: [...OPEN_STAGES_EXCLUDED] } },
      select: { ownerId: true },
      take: 50,
    });
    const alertUserIds = [...new Set([c.keyAccountOwnerId, ...opps.map((o) => o.ownerId)].filter((v): v is string => !!v))];
    const subject: NewsSubject = {
      orgId: c.orgId,
      companyId: c.id,
      companyName: c.name,
      domain: c.domain,
      ticker,
      exchange,
      irFeedUrl: ws?.irFeedUrl ?? null,
      linkedinUrl: linkedinFrom(c.firmographics?.providerIds),
      alertUserIds,
    };
    try {
      const r = await runAccountNews(subject, { fetchImpl, cache, config: cfg, store, now, bodyFetch, sleep });
      summary.accounts++;
      summary.dropped += r.dropped;
      summary.perAccount.push({ companyId: c.id, name: c.name, fetched: r.fetched, kept: r.kept, inserted: r.inserted, dropped: r.dropped });
      // GDELT asks for one call per 5 s per client; after a 429 leave it alone for this run.
      if (cfg.sources.includes('gdelt')) {
        if (r.errors.some((e) => e.startsWith('gdelt rate limited'))) {
          cfg = { ...cfg, sources: cfg.sources.filter((x) => x !== 'gdelt') };
          const level = backoff.level + 1;
          const until = now.getTime() + gdeltBackoffMs(level);
          summary.gdelt = { state: 'rate_limited', level, until: new Date(until).toISOString() };
          await cache.set(GDELT_BACKOFF_KEY, JSON.stringify({ level, until }), 7 * 24 * 3600).catch(() => undefined);
        } else if (!r.errors.some((e) => e.startsWith('gdelt'))) {
          summary.gdelt.state = 'ok';
        }
      }
      summary.inserted += r.inserted;
      summary.merged += r.merged;
      summary.alerted += r.alerted;
      if (r.errors.length) {
        summary.errored++;
        deps.log?.warn({ companyId: c.id, errors: r.errors }, 'watchdog news source failed');
      }
    } catch (err) {
      summary.errored++;
      deps.log?.warn({ companyId: c.id, err: err instanceof Error ? err.message : String(err) }, 'watchdog news account failed');
    }
  }
  if (summary.gdelt.state === 'ok' && backoff.level > 0) {
    await cache.set(GDELT_BACKOFF_KEY, JSON.stringify({ level: 0, until: 0 }), 7 * 24 * 3600).catch(() => undefined);
    summary.gdelt = { state: 'ok', level: 0, until: null };
  }
  deps.log?.info(summary, 'watchdog news scan complete');
  return summary;
}

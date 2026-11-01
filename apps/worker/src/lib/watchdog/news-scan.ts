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

type Db = Pick<typeof prisma, 'accountWatchEvent' | 'notification' | 'company' | 'companyFirmographics' | 'opportunity' | 'accountWatchSubject'>;

export interface NewsScanDeps {
  db?: Db;
  env?: Record<string, string | undefined>;
  fetchImpl?: NewsFetch;
  cache?: NewsCache;
  now?: Date;
  sleep?: (ms: number) => Promise<void>;
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
}

const PACE_MS = 5_000;
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
  const summary: NewsScanSummary = { enabled: config.sources.length > 0, accounts: 0, inserted: 0, merged: 0, alerted: 0, errored: 0 };
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
      accountWatchSubjects: { select: { irFeedUrl: true }, take: 1 },
      firmographics: { select: { providerIds: true } },
    },
    orderBy: { name: 'asc' },
    take: max,
  });
  const store = prismaNewsStore(db);
  const cache = deps.cache ?? memoryNewsCache();
  const fetchImpl = deps.fetchImpl ?? (fetch as unknown as NewsFetch);
  for (const [i, c] of companies.entries()) {
    if (i > 0) await sleep(PACE_MS);
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
      irFeedUrl: c.accountWatchSubjects[0]?.irFeedUrl ?? null,
      linkedinUrl: linkedinFrom(c.firmographics?.providerIds),
      alertUserIds,
    };
    try {
      const r = await runAccountNews(subject, { fetchImpl, cache, config, store, now });
      summary.accounts++;
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
  deps.log?.info(summary, 'watchdog news scan complete');
  return summary;
}

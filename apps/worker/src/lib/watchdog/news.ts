/**
 * Watchdog news pipeline (v21): per-account media, press and provider signals.
 *
 * Sources (each behind a flag; nothing is called unless configured):
 *   gdelt         GDELT DOC 2.0 article search (free, no key). One call per
 *                 account per scan, paced >= 5 s apart (GDELT asks for that).
 *   google_news   Google News RSS search feed (free, no key).
 *   company_rss   The account's own press or IR feed (AccountWatchSubject.irFeedUrl).
 *   apify_linkedin  LinkedIn company updates through an Apify actor the org
 *                 configures. Off unless WATCHDOG_APIFY_LINKEDIN_ENABLED=true,
 *                 APIFY_TOKEN and WATCHDOG_APIFY_LINKEDIN_ACTOR are all set.
 *                 Never scrapes LinkedIn directly and never sends cookies,
 *                 sessions or logins: inputs that carry any are refused.
 * Funding and job signals from Apollo arrive through account enrichment
 * (source 'apollo'), not through this file.
 *
 * Pipeline: fetch -> keep items that name the account -> classify (shared
 * rules) -> importance -> dedupe (same story in the batch, or a stored row
 * with the same dedupe key in the last 14 days bumps `mentions` instead of
 * inserting) -> insert -> alert at importance >= ALERT_IMPORTANCE.
 * Responses are cached (6 h by default) so restarts do not re-hit sources.
 */
import {
  ALERT_IMPORTANCE,
  classifySignalText,
  cleanText,
  importanceScore,
  oneLine,
  severityFromImportance,
  signalDedupeKey,
  stripPublisher,
  titleSimilarity,
  type Implication,
  type WatchEventKind,
} from '@bidstack/shared';

export const NEWS_SOURCES = ['gdelt', 'google_news', 'company_rss', 'apify_linkedin'] as const;
export type NewsSourceId = (typeof NEWS_SOURCES)[number];

export const NEWS_SOURCE_LABEL: Record<NewsSourceId, string> = {
  gdelt: 'GDELT news',
  google_news: 'Google News',
  company_rss: 'Company press feed',
  apify_linkedin: 'LinkedIn company updates (Apify)',
};

export interface NewsItem {
  source: NewsSourceId;
  url: string;
  title: string;
  description: string;
  publisher: string | null;
  publishedAt: Date;
}

export interface NewsSubject {
  orgId: string;
  companyId: string;
  companyName: string;
  domain: string | null;
  irFeedUrl: string | null;
  linkedinUrl: string | null;
  alertUserIds: string[];
}

export interface NewsFetch {
  (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }): Promise<{
    ok: boolean;
    status: number;
    text(): Promise<string>;
  }>;
}

export interface NewsCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
}

export function memoryNewsCache(now: () => number = Date.now): NewsCache {
  const m = new Map<string, { v: string; exp: number }>();
  return {
    async get(k) {
      const hit = m.get(k);
      if (!hit) return null;
      if (hit.exp < now()) {
        m.delete(k);
        return null;
      }
      return hit.v;
    },
    async set(k, v, ttl) {
      if (m.size > 2000) m.clear();
      m.set(k, { v, exp: now() + ttl * 1000 });
    },
  };
}

/** Minimal ioredis surface, so tests need no Redis. */
export function redisNewsCache(redis: { get(k: string): Promise<string | null>; set(k: string, v: string, mode: 'EX', ttl: number): Promise<unknown> }): NewsCache {
  return {
    get: (k) => redis.get(`watchdog:news:${k}`),
    async set(k, v, ttl) {
      await redis.set(`watchdog:news:${k}`, v, 'EX', ttl);
    },
  };
}

export interface NewsConfig {
  sources: NewsSourceId[];
  cacheTtlSeconds: number;
  lookbackDays: number;
  apify: { token: string; actor: string } | null;
  userAgent: string;
}

/** Flags: WATCHDOG_NEWS_SOURCES=gdelt,google_news,company_rss (default: none). */
export function newsConfigFromEnv(env: Record<string, string | undefined>): NewsConfig {
  const wanted = (env.WATCHDOG_NEWS_SOURCES ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is NewsSourceId => (NEWS_SOURCES as readonly string[]).includes(s) && s !== 'apify_linkedin');
  const apifyOn = env.WATCHDOG_APIFY_LINKEDIN_ENABLED === 'true';
  const token = env.APIFY_TOKEN?.trim() ?? '';
  const actor = env.WATCHDOG_APIFY_LINKEDIN_ACTOR?.trim() ?? '';
  const apify = apifyOn && token && /^[\w.-]+[~/][\w.-]+$/.test(actor) ? { token, actor: actor.replace('/', '~') } : null;
  const sources = [...new Set(wanted)];
  if (apify) sources.push('apify_linkedin');
  const ttl = Number.parseInt(env.WATCHDOG_NEWS_CACHE_TTL_S ?? '', 10);
  const look = Number.parseInt(env.WATCHDOG_NEWS_LOOKBACK_DAYS ?? '', 10);
  return {
    sources,
    cacheTtlSeconds: Number.isFinite(ttl) && ttl >= 300 ? ttl : 6 * 3600,
    lookbackDays: Number.isFinite(look) && look >= 1 && look <= 90 ? look : 14,
    apify,
    userAgent: env.WATCHDOG_USER_AGENT?.trim() || env.SEC_USER_AGENT?.trim() || 'Polo account watchdog',
  };
}

// ── Parsers ────────────────────────────────────────────────────────────────

/** GDELT seendate "20261030T141500Z" -> Date. */
export function parseGdeltDate(s: string): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s);
  if (!m) return null;
  return new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!));
}

export function parseGdelt(body: string): NewsItem[] {
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return []; // GDELT answers plain text for bad queries
  }
  const arts = (data as { articles?: unknown }).articles;
  if (!Array.isArray(arts)) return [];
  const out: NewsItem[] = [];
  for (const a of arts as Array<Record<string, unknown>>) {
    const url = typeof a.url === 'string' ? a.url : '';
    const title = typeof a.title === 'string' ? a.title : '';
    const at = typeof a.seendate === 'string' ? parseGdeltDate(a.seendate) : null;
    if (!/^https?:\/\//.test(url) || !title || !at) continue;
    out.push({ source: 'gdelt', url, title, description: '', publisher: typeof a.domain === 'string' ? a.domain : null, publishedAt: at });
  }
  return out;
}

function tag(xml: string, name: string): string {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(xml);
  if (!m?.[1]) return '';
  return m[1].replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1').trim();
}

/** RSS 2.0 items or Atom entries, regex based (feeds are small and flat). */
export function parseFeed(xml: string, source: NewsSourceId): NewsItem[] {
  const out: NewsItem[] = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ?? [];
  for (const b of blocks) {
    const title = cleanText(tag(b, 'title'));
    let url = cleanText(tag(b, 'link'));
    if (!url) url = /<link[^>]*href="([^"]+)"/i.exec(b)?.[1] ?? '';
    const when = tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date');
    const at = when ? new Date(when) : null;
    if (!title || !/^https?:\/\//.test(url) || !at || Number.isNaN(at.getTime())) continue;
    out.push({
      source,
      url,
      title,
      description: cleanText(tag(b, 'description') || tag(b, 'summary') || tag(b, 'content')),
      publisher: cleanText(tag(b, 'source')) || null,
      publishedAt: at,
    });
  }
  return out;
}

/** Apify dataset items: field names vary by actor, so read the common ones. */
export function parseApifyItems(items: unknown): NewsItem[] {
  if (!Array.isArray(items)) return [];
  const out: NewsItem[] = [];
  for (const raw of items as Array<Record<string, unknown>>) {
    const text = [raw.text, raw.title, raw.content, raw.postText].find((v): v is string => typeof v === 'string' && v.trim().length > 0) ?? '';
    const url = [raw.url, raw.postUrl, raw.link].find((v): v is string => typeof v === 'string' && /^https?:\/\//.test(v)) ?? '';
    const when = [raw.postedAt, raw.date, raw.publishedAt, raw.time].find((v): v is string => typeof v === 'string');
    const at = when ? new Date(when) : null;
    if (!text || !url || !at || Number.isNaN(at.getTime())) continue;
    out.push({ source: 'apify_linkedin', url, title: oneLine(text, 140), description: cleanText(text), publisher: 'LinkedIn', publishedAt: at });
  }
  return out;
}

// ── Source URLs ────────────────────────────────────────────────────────────

export function gdeltUrl(name: string, days: number): string {
  const q = encodeURIComponent(`"${name}"`);
  return `https://api.gdeltproject.org/api/v2/doc/doc?query=${q}&mode=ArtList&format=json&maxrecords=50&sort=DateDesc&timespan=${days}d`;
}

export function googleNewsUrl(name: string, days: number): string {
  const q = encodeURIComponent(`"${name}" when:${days}d`);
  return `https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`;
}

const LOGIN_KEYS = /cookie|session|li_at|password|login|credential/i;

/** Refuse any actor input that would carry a login. */
export function apifyInput(linkedinUrl: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  for (const k of Object.keys(extra)) {
    if (LOGIN_KEYS.test(k)) throw new Error('Apify LinkedIn input must not carry cookies, sessions or logins');
  }
  if (!/^https:\/\/(www\.)?linkedin\.com\/company\/[\w.-]+\/?$/.test(linkedinUrl)) throw new Error('not a LinkedIn company URL');
  return { companyUrls: [linkedinUrl], startUrls: [{ url: linkedinUrl }], limit: 20, ...extra };
}

// ── Fetching ───────────────────────────────────────────────────────────────

async function cachedText(
  key: string,
  url: string,
  deps: { fetchImpl: NewsFetch; cache: NewsCache; ttl: number; init?: Parameters<NewsFetch>[1] },
): Promise<string> {
  const hit = await deps.cache.get(key);
  if (hit !== null) return hit;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 15_000);
  try {
    const res = await deps.fetchImpl(url, { ...deps.init, signal: ac.signal });
    if (res.status === 429) throw Object.assign(new Error(`${key.split(':')[0]} rate limited (429)`), { retryable: true });
    if (!res.ok) throw new Error(`${key.split(':')[0]} HTTP ${res.status}`);
    const text = await res.text();
    await deps.cache.set(key, text, deps.ttl);
    return text;
  } finally {
    clearTimeout(timer);
  }
}

export interface FetchNewsDeps {
  fetchImpl: NewsFetch;
  cache: NewsCache;
  config: NewsConfig;
}

/** Pull every configured source for one account. Errors are per source. */
export async function fetchAccountNews(subject: NewsSubject, deps: FetchNewsDeps): Promise<{ items: NewsItem[]; errors: string[] }> {
  const { config } = deps;
  const items: NewsItem[] = [];
  const errors: string[] = [];
  const base = { fetchImpl: deps.fetchImpl, cache: deps.cache, ttl: config.cacheTtlSeconds };
  const ua = { 'User-Agent': config.userAgent };
  for (const source of config.sources) {
    try {
      if (source === 'gdelt') {
        const body = await cachedText(`gdelt:${subject.companyId}`, gdeltUrl(subject.companyName, config.lookbackDays), { ...base, init: { headers: ua } });
        items.push(...parseGdelt(body));
      } else if (source === 'google_news') {
        const body = await cachedText(`gnews:${subject.companyId}`, googleNewsUrl(subject.companyName, config.lookbackDays), { ...base, init: { headers: ua } });
        items.push(...parseFeed(body, 'google_news'));
      } else if (source === 'company_rss') {
        if (!subject.irFeedUrl || !/^https:\/\//.test(subject.irFeedUrl)) continue;
        const body = await cachedText(`rss:${subject.companyId}`, subject.irFeedUrl, { ...base, init: { headers: ua } });
        items.push(...parseFeed(body, 'company_rss'));
      } else if (source === 'apify_linkedin') {
        if (!config.apify || !subject.linkedinUrl) continue;
        const body = await cachedText(
          `apify:${subject.companyId}`,
          `https://api.apify.com/v2/acts/${encodeURIComponent(config.apify.actor)}/run-sync-get-dataset-items?timeout=60`,
          {
            ...base,
            init: {
              method: 'POST',
              headers: { authorization: `Bearer ${config.apify.token}`, 'content-type': 'application/json' },
              body: JSON.stringify(apifyInput(subject.linkedinUrl)),
            },
          },
        );
        items.push(...parseApifyItems(JSON.parse(body)));
      }
    } catch (err) {
      // Message only: never the URL (the Apify call carries a token header, not a URL secret, but keep it uniform).
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  return { items, errors };
}

// ── Processing ─────────────────────────────────────────────────────────────

export interface NewsRow {
  orgId: string;
  companyId: string;
  source: string;
  externalId: string;
  kind: WatchEventKind;
  occurredAt: Date;
  title: string;
  sourceUrl: string;
  summary: string;
  implication: Implication;
  rationale: string;
  severity: number;
  importance: number;
  sentiment: number;
  dedupeKey: string;
  mentions: number;
  confirmed: boolean;
  payload: Record<string, unknown>;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Does the text name the account? Guards against homonyms in search results. */
export function mentionsCompany(text: string, companyName: string): boolean {
  const core = companyName
    .replace(/\b(inc|ltd|plc|corp|corporation|co|group|sa|ag|nv|llc|asa|bank)\b\.?/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const name = core.length >= 3 ? core : companyName;
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(name)}([^\\p{L}\\p{N}]|$)`, 'iu').test(text);
}

/** Stable per URL, without the query string's tracking noise. */
export function newsExternalId(url: string): string {
  let u = url;
  try {
    const p = new URL(url);
    p.hash = '';
    for (const k of [...p.searchParams.keys()]) if (/^(utm_|oc$|ref$|fbclid|gclid)/i.test(k)) p.searchParams.delete(k);
    u = p.toString();
  } catch {
    /* keep raw */
  }
  return u.length <= 500 ? u : u.slice(0, 500);
}

const RATIONALE: Partial<Record<WatchEventKind, string>> = {
  FUNDING_ROUND: 'New money usually funds hiring and projects in the next two quarters.',
  PRODUCT_LAUNCH: 'A launch brings scale-up, support and integration work.',
  STRATEGIC_INITIATIVE: 'A named programme needs delivery capacity and a partner.',
  PARTNERSHIP: 'New partners often mean integration work and new decision makers.',
  M_AND_A: 'Integration, carve-out and systems consolidation demand.',
  LEADERSHIP_CHANGE: 'New decision makers to meet; sponsor risk on running deals.',
  LAYOFFS: 'Budget pressure: discretionary projects may pause.',
  INSOLVENCY: 'Payment and continuity risk on open work.',
  EARNINGS_RELEASE: 'Read guidance and cost programmes before the next call.',
  HIRING_SPIKE: 'Fast hiring signals funded work and capacity gaps.',
};

/** Items -> rows: name check, classify, score, dedupe within the batch. */
export function processNews(subject: NewsSubject, items: NewsItem[], opts: { now: Date; lookbackDays: number }): NewsRow[] {
  const since = opts.now.getTime() - opts.lookbackDays * 86_400_000;
  const rows: NewsRow[] = [];
  const sorted = [...items].sort((a, b) => a.publishedAt.getTime() - b.publishedAt.getTime());
  for (const it of sorted) {
    if (it.publishedAt.getTime() < since || it.publishedAt.getTime() > opts.now.getTime() + 86_400_000) continue;
    const title = stripPublisher(it.title, it.publisher);
    // The company's own feed and the LinkedIn page are about the company by definition.
    const own = it.source === 'company_rss' || it.source === 'apify_linkedin';
    if (!own && !mentionsCompany(`${title} ${it.description}`, subject.companyName)) continue;
    const c = classifySignalText(title, it.description);
    const key = signalDedupeKey(c.kind, title, subject.companyName);
    const dup = rows.find((r) => r.dedupeKey === key || (r.kind === c.kind && titleSimilarity(r.title, title, subject.companyName) >= 0.4));
    if (dup) {
      dup.mentions += 1;
      dup.importance = importanceScore({ kind: dup.kind, implication: dup.implication, source: dup.source, mentions: dup.mentions });
      dup.severity = severityFromImportance(dup.importance);
      const outlets = (dup.payload.outlets as string[] | undefined) ?? [];
      if (it.publisher && !outlets.includes(it.publisher)) outlets.push(it.publisher);
      dup.payload.outlets = outlets;
      continue;
    }
    const importance = importanceScore({ kind: c.kind, implication: c.implication, source: it.source });
    rows.push({
      orgId: subject.orgId,
      companyId: subject.companyId,
      source: it.source,
      externalId: newsExternalId(it.url),
      kind: c.kind,
      occurredAt: it.publishedAt,
      title: oneLine(title, 200),
      sourceUrl: it.url,
      summary: oneLine(it.description && it.description !== title ? it.description : title),
      implication: c.implication,
      rationale: RATIONALE[c.kind] ?? `Classified by ${c.rule}.`,
      severity: severityFromImportance(importance),
      importance,
      sentiment: c.sentiment,
      dedupeKey: key,
      mentions: 1,
      confirmed: it.source === 'company_rss',
      payload: { publisher: it.publisher, outlets: it.publisher ? [it.publisher] : [], rule: c.rule, category: c.category },
    });
  }
  return rows;
}

export interface NewsStore {
  /** Stored rows for the account with these dedupe keys since `since`. */
  findByDedupeKeys(orgId: string, companyId: string, keys: string[], since: Date): Promise<Array<{ id: string; dedupeKey: string; mentions: number; kind: string; implication: Implication; source: string }>>;
  /** Insert, skipping (orgId, source, externalId) duplicates; returns inserted rows. */
  insert(rows: NewsRow[]): Promise<NewsRow[]>;
  bump(id: string, mentions: number, importance: number): Promise<void>;
  notify(input: { orgId: string; userIds: string[]; companyId: string; title: string; body: string; url: string }): Promise<void>;
}

export interface NewsRunResult {
  fetched: number;
  kept: number;
  inserted: number;
  merged: number;
  alerted: number;
  errors: string[];
}

/** One account: fetch, process, merge with stored stories, insert, alert. */
export async function runAccountNews(
  subject: NewsSubject,
  deps: FetchNewsDeps & { store: NewsStore; now?: Date },
): Promise<NewsRunResult> {
  const now = deps.now ?? new Date();
  const { items, errors } = await fetchAccountNews(subject, deps);
  const rows = processNews(subject, items, { now, lookbackDays: deps.config.lookbackDays });
  const existing = rows.length
    ? await deps.store.findByDedupeKeys(subject.orgId, subject.companyId, rows.map((r) => r.dedupeKey), new Date(now.getTime() - 14 * 86_400_000))
    : [];
  const byKey = new Map(existing.map((e) => [e.dedupeKey, e]));
  const fresh: NewsRow[] = [];
  let merged = 0;
  for (const r of rows) {
    const old = byKey.get(r.dedupeKey);
    if (old && old.source !== r.source) {
      const mentions = old.mentions + r.mentions;
      await deps.store.bump(old.id, mentions, importanceScore({ kind: old.kind, implication: old.implication, source: old.source, mentions }));
      merged++;
    } else if (!old) fresh.push(r);
  }
  const inserted = fresh.length ? await deps.store.insert(fresh) : [];
  let alerted = 0;
  if (subject.alertUserIds.length) {
    for (const r of inserted.filter((x) => x.importance >= ALERT_IMPORTANCE)) {
      const lead = r.implication === 'RISK' ? 'Risk' : r.implication === 'OPPORTUNITY' ? 'Opportunity' : 'Update';
      await deps.store.notify({
        orgId: subject.orgId,
        userIds: subject.alertUserIds,
        companyId: subject.companyId,
        title: `${lead} at ${subject.companyName}: ${r.title}`,
        body: r.summary,
        url: `/dashboard?account=${subject.companyId}#watchdog`,
      });
      alerted++;
    }
  }
  return { fetched: items.length, kept: rows.length, inserted: inserted.length, merged, alerted, errors };
}

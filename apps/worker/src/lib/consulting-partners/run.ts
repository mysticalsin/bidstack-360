/**
 * Consulting partners scan for one account (slice 15).
 *
 * Public sources, all through the polite intel client (contact User-Agent,
 * robots.txt, cache, per-host gap):
 *   GDELT DOC 2.0     "Client" (firm OR firm ...) (partner OR selects OR alliance OR transformation)
 *   Google News RSS   the same query, plus a site: query on the firms' own
 *                     domains for case studies and press releases
 *   stored posts      the client's newsroom and IR posts already fetched by
 *                     account intel (no new request)
 * Internal sources: our notes, meetings, activities, filed emails, win/loss
 * and bid competitor fields, read by @bidstack/db scanInternalPartnerEvidence.
 *
 * No logins, no people lookup, no contact data. Excerpts strip emails and
 * phone numbers. The optional LLM pass only adds remarks whose quote appears
 * verbatim in the stored excerpt, marked llm_extract and inferred.
 */
import {
  type ConsultingFirm,
  firmsIn,
  type PartnerEvidenceDraft,
  type PartnerPublicItem,
  PartnerRemark,
  readPublicItem,
  sentimentFromRemarks,
} from '@bidstack/shared';

import { createIntelClient, type IntelCache, type IntelFetch, IntelHttpError, memoryIntelCache, RobotsDisallowedError, intelUserAgent } from '../account-intel/http.js';
import { parseFeed, parseGdelt } from '../watchdog/news.js';

/** The account being scanned. */
export interface PartnerSubject {
  orgId: string;
  companyId: string;
  companyName: string;
}

/** Persistence seam: Prisma in production, memory in tests. */
export interface PartnerStore {
  subject(orgId: string, companyId: string): Promise<PartnerSubject | null>;
  firms(orgId: string): Promise<ConsultingFirm[]>;
  /** Posts and news already stored for the account. */
  storedItems(orgId: string, companyId: string): Promise<PartnerPublicItem[]>;
  internal(orgId: string, companyId: string, firms: ConsultingFirm[]): Promise<PartnerEvidenceDraft[]>;
  save(orgId: string, companyId: string, drafts: PartnerEvidenceDraft[], now: Date): Promise<{ new: number; updated: number; removed: number }>;
  setRun(orgId: string, companyId: string, run: { status: string; lastFetchedAt?: Date | null; result?: PartnerRunCounts; detail?: string | null }): Promise<void>;
}

/** Counts shown next to Refresh. */
export interface PartnerRunCounts {
  new: number;
  updated: number;
  skipped: number;
  failed: number;
}

/** LLM seam: system and user prompt in, JSON text out. */
export type PartnerLlm = (input: { system: string; user: string }) => Promise<string>;

/** Dependencies of one run. */
export interface PartnerRunDeps {
  store: PartnerStore;
  env: Record<string, string | undefined>;
  fetchImpl: IntelFetch;
  now: Date;
  cache?: IntelCache;
  sleep?: (ms: number) => Promise<void>;
  llm?: PartnerLlm | null;
}

/** What one run did. */
export interface PartnerRunResult {
  status: 'ok' | 'partial' | 'failed' | 'skipped';
  counts: PartnerRunCounts;
  detail: string | null;
}

const FIRMS_PER_QUERY = 6;
const MAX_LLM_RECORDS = 20;
/** GDELT asks for at least five seconds between requests. */
const GDELT_GAP_MS = 5_500;
const RELATION_TERMS = '(partner OR selects OR alliance OR transformation)';
const sharedCache = memoryIntelCache();

const chunk = <T>(xs: T[], n: number): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
const quote = (s: string) => `"${s.replace(/"/g, '')}"`;

/** GDELT query naming the client and a group of firms. */
export function partnerGdeltUrl(client: string, firms: ConsultingFirm[]): string {
  const q = `${quote(client)} (${firms.map((f) => quote(f.name)).join(' OR ')}) ${RELATION_TERMS}`;
  return `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(q)}&mode=ArtList&format=json&maxrecords=50&sort=DateDesc&timespan=3months`;
}

/** Google News RSS query naming the client and a group of firms. */
export function partnerGoogleNewsUrl(client: string, firms: ConsultingFirm[]): string {
  const q = `${quote(client)} (${firms.map((f) => quote(f.name)).join(' OR ')}) ${RELATION_TERMS}`;
  return `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
}

/** Google News RSS query for the client on the firms' own sites (case studies, press releases). */
export function partnerFirmSiteUrl(client: string, firms: ConsultingFirm[]): string | null {
  const sites = firms.flatMap((f) => f.domains.slice(0, 1)).map((d) => `site:${d}`);
  if (sites.length === 0) return null;
  const q = `${quote(client)} (${sites.join(' OR ')})`;
  return `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
}

const hostOf = (url: string | null | undefined): string | null => {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
};

const LLM_SYSTEM = [
  'You read one excerpt from our own CRM records about a client account.',
  'List remarks that compare us with a named consulting firm on quality, price, speed or domain depth.',
  'Answer JSON {"remarks":[{"firm":"<firm name as written>","dimension":"quality|price|speed|domain","favours":"us|partner|neutral","quote":"<exact words copied from the excerpt>"}]}.',
  'Copy quotes character for character. If the excerpt has no such remark, answer {"remarks":[]}. Never guess.',
].join(' ');

/**
 * Optional LLM pass over internal drafts the keyword rules found no remark in.
 * A remark survives only when its quote is verbatim in the excerpt and its
 * firm is the draft's firm.
 */
export async function llmPartnerRemarks(drafts: PartnerEvidenceDraft[], firms: readonly ConsultingFirm[], llm: PartnerLlm): Promise<number> {
  let added = 0;
  const todo = drafts.filter((d) => d.origin === 'internal' && d.remarks.length === 0 && d.method === 'keyword_match').slice(0, MAX_LLM_RECORDS);
  for (const d of todo) {
    let raw: string;
    try {
      raw = await llm({ system: LLM_SYSTEM, user: d.excerpt });
    } catch {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    const list = (parsed as { remarks?: unknown }).remarks;
    if (!Array.isArray(list)) continue;
    const kept = [];
    for (const r of list.slice(0, 6) as Array<Record<string, unknown>>) {
      const phrase = typeof r.quote === 'string' ? r.quote.trim() : '';
      if (phrase.length < 4 || !d.excerpt.includes(phrase)) continue;
      if (typeof r.firm !== 'string' || !firmsIn(r.firm, firms).includes(d.firmKey)) continue;
      const remark = PartnerRemark.safeParse({ dimension: r.dimension, favours: r.favours, phrase: phrase.slice(0, 200) });
      if (remark.success) kept.push(remark.data);
    }
    if (kept.length) {
      d.remarks = kept;
      d.sentiment = sentimentFromRemarks(kept);
      d.method = 'llm_extract';
      d.inferred = true;
      added += kept.length;
    }
  }
  return added;
}

/** Scan one account and store what was found. Never throws for one bad source. */
export async function runConsultingPartners(input: { orgId: string; companyId: string }, deps: PartnerRunDeps): Promise<PartnerRunResult> {
  const { store, now } = deps;
  const subject = await store.subject(input.orgId, input.companyId);
  if (!subject) return { status: 'skipped', counts: { new: 0, updated: 0, skipped: 0, failed: 0 }, detail: 'Account not found' };
  await store.setRun(input.orgId, input.companyId, { status: 'running' });
  const firms = await store.firms(input.orgId);
  const counts: PartnerRunCounts = { new: 0, updated: 0, skipped: 0, failed: 0 };
  const notes: string[] = [];
  const drafts: PartnerEvidenceDraft[] = [];

  for (const item of await store.storedItems(subject.orgId, subject.companyId)) {
    const read = readPublicItem(item, subject.companyName, firms);
    if (read.length === 0) counts.skipped++;
    drafts.push(...read);
  }

  const ua = intelUserAgent(deps.env);
  if (!ua) {
    notes.push('Set ACCOUNT_INTEL_USER_AGENT to a User-Agent that names a contact to fetch public partner news');
  } else {
    const client = createIntelClient({ fetchImpl: deps.fetchImpl, userAgent: ua, cache: deps.cache ?? sharedCache, minGapMs: GDELT_GAP_MS, sleep: deps.sleep });
    const groups = chunk(firms, FIRMS_PER_QUERY);
    const requests: Array<{ url: string; parse: (body: string) => PartnerPublicItem[] }> = [];
    for (const g of groups) {
      requests.push({ url: partnerGdeltUrl(subject.companyName, g), parse: (b) => parseGdelt(b).map((n) => ({ source: 'gdelt', url: n.url, title: n.title, description: n.description, publishedAt: n.publishedAt, host: n.publisher })) });
      requests.push({
        url: partnerGoogleNewsUrl(subject.companyName, g),
        parse: (b) => parseFeed(b, 'google_news').map((n) => ({ source: 'google_news', url: n.url, title: n.title, description: n.description, publishedAt: n.publishedAt, host: hostOf(n.publisherUrl) })),
      });
      const site = partnerFirmSiteUrl(subject.companyName, g);
      if (site) {
        requests.push({
          url: site,
          parse: (b) => parseFeed(b, 'google_news').map((n) => ({ source: 'google_news', url: n.url, title: n.title, description: n.description, publishedAt: n.publishedAt, host: hostOf(n.publisherUrl) })),
        });
      }
    }
    for (const r of requests) {
      try {
        const items = r.parse(await client.get(r.url, { accept: r.url.includes('gdeltproject') ? 'application/json' : 'application/rss+xml' }));
        for (const item of items) {
          const read = readPublicItem(item, subject.companyName, firms);
          if (read.length === 0) counts.skipped++;
          drafts.push(...read);
        }
      } catch (err) {
        counts.failed++;
        if (err instanceof RobotsDisallowedError) notes.push(`robots.txt disallows ${hostOf(r.url)}`);
        else if (err instanceof IntelHttpError) notes.push(`${hostOf(r.url)} answered ${err.status}`);
        else notes.push(`${hostOf(r.url)} unreachable`);
      }
    }
  }

  const internal = await store.internal(subject.orgId, subject.companyId, firms);
  if (deps.llm && deps.env.CONSULTING_PARTNERS_LLM === 'true') await llmPartnerRemarks(internal, firms, deps.llm);
  drafts.push(...internal);

  const saved = await store.save(subject.orgId, subject.companyId, drafts, now);
  counts.new = saved.new;
  counts.updated = saved.updated;
  const status: PartnerRunResult['status'] = counts.failed > 0 ? (drafts.length > 0 || counts.failed < 3 ? 'partial' : 'failed') : 'ok';
  const detail = notes.length ? [...new Set(notes)].slice(0, 4).join('; ').slice(0, 500) : null;
  await store.setRun(subject.orgId, subject.companyId, { status: ua ? status : 'not_configured', lastFetchedAt: now, result: counts, detail });
  return { status, counts, detail };
}

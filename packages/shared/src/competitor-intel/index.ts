/**
 * Competitor intelligence — grounded, cited, never invented.
 *
 * Pure logic shared by the API and the worker (which cannot import from
 * `apps/api`). The no-hallucination guarantee is enforced HERE, in code:
 *
 *   1. `enforceCitations()` drops any model finding whose `sourceUrl` is not one
 *      of the documents we actually fetched this run. The LLM may only extract
 *      from supplied sources; it can never introduce a URL or a claim of its own.
 *   2. Structured connectors (USASpending) bypass the LLM entirely — their
 *      insights are built directly from API rows and are cited by construction.
 *   3. The `CompetitorInsight` DB row has `sourceUrl` NOT NULL, so an uncited
 *      insight cannot even be persisted.
 *
 * See `docs/competitor-intel.md`.
 */

import { z } from 'zod';

import { assertPublicHttpUrl } from '../utils/ssrf.js';

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

// ─── Categories ────────────────────────────────────────────────────────────

export const COMPETITOR_INSIGHT_CATEGORIES = [
  'pricing',
  'win_loss',
  'capability',
  'positioning',
  'rfp_response',
  'news',
  'other',
] as const;
export type CompetitorInsightCategory = (typeof COMPETITOR_INSIGHT_CATEGORIES)[number];

// ─── Structured finding contract (what the LLM must return) ─────────────────

export const CompetitorFindingSchema = z.object({
  category: z.enum(COMPETITOR_INSIGHT_CATEGORIES),
  title: z.string().trim().min(1).max(255),
  summary: z.string().trim().min(1),
  /** MUST be one of the supplied source URLs — enforced by enforceCitations(). */
  sourceUrl: z.string().trim().url(),
  confidence: z.number().min(0).max(1).optional(),
  amount: z.number().nonnegative().optional(),
  currency: z.string().trim().length(3).optional(),
});
export type CompetitorFinding = z.infer<typeof CompetitorFindingSchema>;

export const CompetitorExtractionSchema = z.object({
  findings: z.array(CompetitorFindingSchema).max(40),
});

/** A document we actually retrieved — the only thing the LLM is allowed to cite. */
export interface GroundedSource {
  url: string;
  title: string | null;
  snippet: string;
  publishedAt?: string | null;
}

/** Persistence-ready insight (maps 1:1 to the CompetitorInsight model). */
export interface CompetitorInsightDraft {
  category: CompetitorInsightCategory;
  title: string;
  summary: string;
  sourceUrl: string;
  sourceTitle: string | null;
  sourceSnippet: string | null;
  provider: string;
  /** Confidence in basis points (0–10000) per the repo's bps convention. */
  confidenceBps: number;
  publishedAt: string | null;
  metadata: Record<string, unknown>;
}

// ─── Cite-or-omit enforcement (THE no-hallucination guarantee) ──────────────

/**
 * Canonicalise a URL for citation comparison.
 *
 * RFC 3986: only scheme and host are case-insensitive — path and query are
 * case-SENSITIVE. Lowercasing the whole URL (the original bug) let a model
 * invent `/pricing.md` and have it collide with a fetched `/PRICING.md`,
 * defeating enforceCitations on case-sensitive hosts (GitHub raw, S3, nginx…).
 * So we lowercase ONLY scheme+host, drop the default port, strip userinfo and
 * fragment, and trim a trailing slash — leaving path+query byte-exact.
 */
export function normalizeUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    const protocol = u.protocol.toLowerCase();
    const host = u.hostname.toLowerCase();
    const isDefaultPort =
      (protocol === 'https:' && u.port === '443') || (protocol === 'http:' && u.port === '80');
    const port = u.port && !isDefaultPort ? `:${u.port}` : '';
    let pathname = u.pathname;
    if (pathname.endsWith('/') && pathname !== '/') pathname = pathname.slice(0, -1);
    if (pathname === '/') pathname = '';
    // userinfo + fragment intentionally dropped (not part of resource identity).
    return `${protocol}//${host}${port}${pathname}${u.search}`;
  } catch {
    return null;
  }
}

/**
 * Split findings into those that cite a fetched source (`kept`) and those that
 * cite a URL we never retrieved (`dropped` — i.e. the model invented it).
 */
export function enforceCitations<T extends { sourceUrl: string }>(
  findings: T[],
  allowedSourceUrls: string[],
): { kept: T[]; dropped: T[] } {
  const allowed = new Set(
    allowedSourceUrls.map(normalizeUrl).filter((u): u is string => Boolean(u)),
  );
  const kept: T[] = [];
  const dropped: T[] = [];
  for (const f of findings) {
    const norm = normalizeUrl(f.sourceUrl);
    if (norm && allowed.has(norm)) kept.push(f);
    else dropped.push(f);
  }
  return { kept, dropped };
}

function stripJsonFences(raw: string): string {
  const t = raw.trim();
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return (fence ? (fence[1] ?? '') : t).trim();
}

/**
 * Parse an LLM extraction response into validated findings that ONLY cite
 * fetched sources. A parse/schema failure yields zero findings (fail-closed —
 * we never surface an unparseable model answer as if it were grounded).
 */
export function parseCompetitorFindings(
  raw: string,
  allowedSourceUrls: string[],
): { findings: CompetitorFinding[]; dropped: number; parseError: boolean } {
  let obj: unknown;
  try {
    obj = JSON.parse(stripJsonFences(raw));
  } catch {
    return { findings: [], dropped: 0, parseError: true };
  }
  const parsed = CompetitorExtractionSchema.safeParse(obj);
  if (!parsed.success) return { findings: [], dropped: 0, parseError: true };
  const { kept, dropped } = enforceCitations(parsed.data.findings, allowedSourceUrls);
  return { findings: kept, dropped: dropped.length, parseError: false };
}

/** Map validated, cited findings to persistence-ready drafts. */
export function findingsToInsightDrafts(
  findings: CompetitorFinding[],
  provider: string,
): CompetitorInsightDraft[] {
  return findings.map((f) => ({
    category: f.category,
    title: f.title.slice(0, 255),
    summary: f.summary,
    sourceUrl: f.sourceUrl,
    sourceTitle: null,
    sourceSnippet: null,
    provider,
    confidenceBps: Math.round((f.confidence ?? 0.5) * 10_000),
    publishedAt: null,
    metadata:
      f.amount !== undefined ? { amount: f.amount, currency: f.currency ?? null } : {},
  }));
}

// ─── USASpending connector (cited award pricing, no LLM) ────────────────────

interface UsaSpendingAwardRow {
  ['Award ID']?: string;
  ['Recipient Name']?: string;
  ['Award Amount']?: number;
  ['Awarding Agency']?: string;
  ['Start Date']?: string;
  generated_unique_award_id?: string;
}

/** Specific public award page when we have an id, else the search page. */
export function usaSpendingAwardUrl(generatedUniqueAwardId?: string): string {
  return generatedUniqueAwardId
    ? `https://www.usaspending.gov/award/${encodeURIComponent(generatedUniqueAwardId)}`
    : 'https://www.usaspending.gov/search/';
}

/**
 * Real federal award amounts to a competitor — grounded pricing, each row cited
 * to its own USASpending award page. Returns [] (never throws) on API trouble so
 * a missing public source surfaces as "not found", never as a fabricated number.
 */
export async function buildUsaSpendingCompetitorInsights(opts: {
  competitorName: string;
  now: Date;
  fetchImpl?: FetchLike;
  limit?: number;
}): Promise<CompetitorInsightDraft[]> {
  const { competitorName, now, fetchImpl = fetch, limit = 5 } = opts;
  const name = competitorName.trim();
  if (name.length < 2) return [];

  let rows: UsaSpendingAwardRow[];
  try {
    const res = await fetchJson<{ results?: UsaSpendingAwardRow[] }>(
      'https://api.usaspending.gov/api/v2/search/spending_by_award/',
      fetchImpl,
      {
        method: 'POST',
        body: JSON.stringify({
          filters: {
            recipient_search_text: [name],
            award_type_codes: ['A', 'B', 'C', 'D'],
            time_period: [{ start_date: '2022-01-01', end_date: now.toISOString().slice(0, 10) }],
          },
          fields: ['Award ID', 'Recipient Name', 'Award Amount', 'Awarding Agency', 'Start Date'],
          page: 1,
          limit,
          sort: 'Award Amount',
          order: 'desc',
        }),
      },
    );
    rows = res.results ?? [];
  } catch {
    return [];
  }

  return rows.slice(0, limit).map((row) => {
    const recipient = row['Recipient Name'] ?? name;
    const agency = row['Awarding Agency'] ?? 'Unknown agency';
    const amount = row['Award Amount'] ?? null;
    const sourceUrl = usaSpendingAwardUrl(row.generated_unique_award_id);
    const amountText =
      typeof amount === 'number'
        ? `$${amount.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
        : 'undisclosed amount';
    return {
      category: 'pricing' as const,
      title: `${recipient}: ${amountText} federal award`,
      summary: `${agency} awarded ${recipient} ${amountText} (USASpending, public record).`,
      sourceUrl,
      sourceTitle: 'USASpending federal award record',
      sourceSnippet: `${recipient} — ${amountText} — ${agency}`,
      provider: 'usaspending',
      confidenceBps: 8600,
      publishedAt: row['Start Date'] ?? null,
      metadata: {
        awardId: row['Award ID'] ?? row.generated_unique_award_id ?? null,
        awardAmount: amount,
        agency,
      },
    } satisfies CompetitorInsightDraft;
  });
}

// ─── SSRF-guarded grounded web fetch ────────────────────────────────────────

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m?.[1] ? htmlToText(m[1]).slice(0, 255) : null;
}

/**
 * Follow redirects MANUALLY, re-validating every hop with the SSRF gate. With
 * `redirect: 'follow'` the runtime chases a 3xx to ANY host without re-checking
 * — so a guard-passing public page could 302 to 169.254.169.254 (cloud metadata)
 * and we would exfiltrate it. Manual following closes that hole.
 *
 * NOTE: this string-host gate does not stop DNS rebinding (the resolved IP can
 * differ from the validated hostname at connect time). The production caller
 * MUST inject a `fetchImpl` whose dispatcher pins + validates the resolved IP of
 * every hop. See docs/competitor-intel.md.
 */
async function fetchGuardedRedirects(
  startUrl: URL,
  fetchImpl: FetchLike,
  signal: AbortSignal,
  maxHops = 4,
): Promise<Response | null> {
  let url = startUrl;
  for (let hop = 0; hop <= maxHops; hop++) {
    const res = await fetchImpl(url.toString(), {
      signal,
      redirect: 'manual',
      headers: { Accept: 'text/html,application/xhtml+xml', 'User-Agent': RESEARCH_UA },
    });
    if (res.status < 300 || res.status >= 400) return res;
    const location = res.headers.get('location');
    if (!location) return null;
    try {
      // Resolve relative redirects against the current URL, then re-gate.
      url = assertPublicHttpUrl(new URL(location, url).toString());
    } catch {
      return null; // redirect points at an internal / non-http(s) target → drop
    }
  }
  return null; // redirect chain too long
}

async function fetchOneDocument(
  rawUrl: string,
  fetchImpl: FetchLike,
  maxBytes: number,
): Promise<GroundedSource | null> {
  // SSRF gate — throws on internal / non-http(s) URLs; we skip those.
  let url: URL;
  try {
    url = assertPublicHttpUrl(rawUrl);
  } catch {
    return null;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetchGuardedRedirects(url, fetchImpl, controller.signal);
    if (!res || !res.ok) return null;
    const html = (await res.text()).slice(0, maxBytes);
    const snippet = htmlToText(html).slice(0, 2000);
    if (!snippet) return null;
    // res.url is the final hop after manual following; fall back to the gated url.
    return { url: res.url || url.toString(), title: extractTitle(html), snippet };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const RESEARCH_UA = process.env.COMPETITOR_RESEARCH_UA ?? 'PoloPreSales-Research contact@example.com';

/**
 * Fetch candidate public pages, SSRF-guarded. Returns only documents we actually
 * retrieved — this set IS the allow-list passed to `enforceCitations`, so the LLM
 * can never cite a page we did not fetch.
 */
export async function fetchGroundedDocuments(opts: {
  urls: string[];
  fetchImpl?: FetchLike;
  maxBytes?: number;
  maxDocs?: number;
}): Promise<GroundedSource[]> {
  const { urls, fetchImpl = fetch, maxBytes = 400_000, maxDocs = 8 } = opts;
  const unique = [...new Set(urls.map((u) => u.trim()).filter(Boolean))].slice(0, maxDocs);
  const docs = await Promise.all(unique.map((u) => fetchOneDocument(u, fetchImpl, maxBytes)));
  return docs.filter((d): d is GroundedSource => d !== null);
}

// ─── Shared fetch helper ────────────────────────────────────────────────────

async function fetchJson<T>(url: string, fetchImpl: FetchLike, init: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const headers = new Headers(init.headers);
    if (!headers.has('Accept')) headers.set('Accept', 'application/json');
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    if (!headers.has('User-Agent')) headers.set('User-Agent', RESEARCH_UA);
    const res = await fetchImpl(url, { ...init, signal: controller.signal, headers });
    if (!res.ok) throw new Error(`USASpending returned HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

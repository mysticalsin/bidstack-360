/**
 * Identifier check for watchdog news (v22, Tony 2026-11-01 00:16 BRT): a story
 * is kept only when it mentions the account's own website domain or its stock
 * ticker. Name matches alone are not enough (NOS, MAHLE and DNB all have
 * homonyms or ticker clashes).
 *
 * Order of checks, cheapest first:
 *   1. URL: the article lives on the account's own domain.
 *   2. Title and snippet: domain, or an exchange-qualified ticker.
 *   3. Article body (optional): fetched with a strict timeout and size cap,
 *      only when robots.txt allows it, parsed as plain text (no scripts run).
 * Anything unverified is dropped.
 */

/** Hosts that are never real company websites. */
const RESERVED = /(^|\.)(example\.(com|org|net)|localhost|invalid|test|example|local|internal)$/i;

export function normalizeDomain(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = raw.trim().toLowerCase();
  d = d.replace(/^[a-z]+:\/\//, '').replace(/^www\./, '');
  d = d.split(/[/?#:]/)[0] ?? '';
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d)) return null;
  if (RESERVED.test(d)) return null;
  if (/^\d+(\.\d+){3}$/.test(d)) return null;
  return d;
}

export function normalizeTicker(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim().toUpperCase().replace(/^\$/, '');
  return /^[A-Z0-9]{1,6}([.-][A-Z0-9]{1,3})?$/.test(t) ? t : null;
}

/**
 * Exchange groups: codes, suffixes (ATZ.TO) and country tags (ATZ:CA) that
 * mean the same venue. A ticker is only trusted on its own venue, so "NYSE: DNB"
 * (Dun and Bradstreet) never counts for DNB Bank on Oslo Bors.
 */
const VENUES: Array<{ ids: string[]; prefixes: string[]; suffixes: string[]; countries: string[] }> = [
  { ids: ['TSX', 'TSE', 'XTSE', 'TORONTO'], prefixes: ['TSX', 'TSE'], suffixes: ['TO'], countries: ['CA'] },
  { ids: ['TSXV', 'CVE'], prefixes: ['TSXV', 'TSX-V', 'CVE'], suffixes: ['V'], countries: ['CA'] },
  { ids: ['OSE', 'OB', 'OSL', 'OSLO', 'XOSL'], prefixes: ['OSE', 'OB', 'OSL', 'OSLO', 'OSLO BORS', 'OSLO BØRS'], suffixes: ['OL'], countries: ['NO'] },
  { ids: ['BME', 'MCE', 'BMAD', 'XMAD', 'MADRID'], prefixes: ['BME', 'MCE', 'BMAD'], suffixes: ['MC'], countries: ['ES'] },
  { ids: ['ELI', 'ENXTLS', 'XLIS', 'LISBON', 'EURONEXT LISBON'], prefixes: ['ELI', 'ENXTLS', 'EURONEXT LISBON'], suffixes: ['LS'], countries: ['PT'] },
  { ids: ['EPA', 'ENXTPA', 'XPAR', 'PARIS', 'EURONEXT PARIS'], prefixes: ['EPA', 'ENXTPA', 'EURONEXT PARIS'], suffixes: ['PA'], countries: ['FR'] },
  { ids: ['AMS', 'ENXTAM', 'XAMS'], prefixes: ['AMS', 'ENXTAM'], suffixes: ['AS'], countries: ['NL'] },
  { ids: ['LSE', 'LON', 'XLON'], prefixes: ['LSE', 'LON'], suffixes: ['L'], countries: ['GB', 'UK'] },
  { ids: ['XETRA', 'ETR', 'FRA', 'FWB', 'XETR'], prefixes: ['XETRA', 'ETR', 'FRA', 'FWB'], suffixes: ['DE', 'F'], countries: ['DE'] },
  { ids: ['SIX', 'SWX'], prefixes: ['SIX', 'SWX'], suffixes: ['SW'], countries: ['CH'] },
  { ids: ['NYSE', 'XNYS'], prefixes: ['NYSE'], suffixes: [], countries: ['US'] },
  { ids: ['NASDAQ', 'XNAS', 'NASDAQGS', 'NASDAQGM'], prefixes: ['NASDAQ', 'NASDAQGS', 'NASDAQGM'], suffixes: [], countries: ['US'] },
  { ids: ['ASX'], prefixes: ['ASX'], suffixes: ['AX'], countries: ['AU'] },
  { ids: ['STO', 'XSTO', 'STOCKHOLM'], prefixes: ['STO'], suffixes: ['ST'], countries: ['SE'] },
  { ids: ['CPH', 'XCSE'], prefixes: ['CPH'], suffixes: ['CO'], countries: ['DK'] },
  { ids: ['HEL', 'XHEL'], prefixes: ['HEL'], suffixes: ['HE'], countries: ['FI'] },
  { ids: ['BIT', 'MIL', 'XMIL'], prefixes: ['BIT', 'MIL'], suffixes: ['MI'], countries: ['IT'] },
];

const venueOf = (exchange: string | null | undefined) => {
  const e = (exchange ?? '').trim().toUpperCase();
  return e ? (VENUES.find((v) => v.ids.includes(e) || v.prefixes.includes(e)) ?? null) : null;
};

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const NB = '(?![A-Za-z0-9])'; // ticker must end here
const NA = '(?<![A-Za-z0-9])'; // and start here

export interface AccountIdentifiers {
  domain: string | null;
  ticker: string | null;
  exchange: string | null;
  companyName: string;
}

export function usableIdentifiers(input: { domain?: string | null; ticker?: string | null; exchange?: string | null; companyName: string }): AccountIdentifiers {
  return { domain: normalizeDomain(input.domain), ticker: normalizeTicker(input.ticker), exchange: input.exchange?.trim() || null, companyName: input.companyName };
}

export const hasNewsIdentifiers = (ids: AccountIdentifiers) => Boolean(ids.domain || ids.ticker);

export function hostOnDomain(url: string, domain: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return h === domain || h.endsWith(`.${domain}`);
  } catch {
    return false;
  }
}

/** "ci.com", "www.ci.com", "ir.ci.com/x" count; "aci.com" and "ci.com.br" do not. */
export function mentionsDomain(text: string, domain: string): boolean {
  return new RegExp(`(^|[^a-z0-9.-])(?:https?://)?(?:[a-z0-9-]+\\.)*${esc(domain)}(?![a-z0-9-]|\\.[a-z0-9])`, 'i').test(text);
}

/**
 * Ticker strength: 'strong' when tied to the account's venue (TSX:CIX,
 * CIX.TO, CIX:CA), 'weak' for a cashtag or a venue we cannot check
 * (needs the company name as well), 'none' otherwise.
 */
export function tickerMention(text: string, ticker: string, exchange: string | null): 'strong' | 'weak' | 'none' {
  const t = esc(ticker);
  const venue = venueOf(exchange);
  const allPrefixes = VENUES.flatMap((v) => v.prefixes);
  const prefixRe = (ps: string[]) => new RegExp(`${NA}(?:${ps.map(esc).join('|')})\\s*[:：]\\s*${t}${NB}`, 'i');
  const suffixRe = (ss: string[]) => (ss.length ? new RegExp(`${NA}${t}\\.(?:${ss.map(esc).join('|')})${NB}`) : null);
  const countryRe = (cs: string[]) => (cs.length ? new RegExp(`${NA}${t}:(?:${cs.map(esc).join('|')})${NB}`) : null);
  if (venue) {
    if (prefixRe(venue.prefixes).test(text)) return 'strong';
    if (suffixRe(venue.suffixes)?.test(text)) return 'strong';
    if (countryRe(venue.countries)?.test(text)) return 'strong';
    if (new RegExp(`${NA}\\$${t}${NB}`).test(text)) return 'weak';
    return 'none';
  }
  if (prefixRe(allPrefixes).test(text)) return 'weak';
  if (new RegExp(`${NA}\\$${t}${NB}`).test(text)) return 'weak';
  if (new RegExp(`${NA}${t}\\.[A-Z]{1,2}${NB}`).test(text)) return 'weak';
  return 'none';
}

const NAME_STOP = /\b(inc|ltd|plc|corp|corporation|co|group|sa|ag|nv|llc|asa|bank|se|sgps|s\.a\.)\b\.?/gi;

export function mentionsName(text: string, companyName: string): boolean {
  const core = companyName.replace(NAME_STOP, ' ').replace(/\s+/g, ' ').trim();
  const name = core.length >= 3 ? core : companyName;
  return new RegExp(`(^|[^\\p{L}\\p{N}])${esc(name)}([^\\p{L}\\p{N}]|$)`, 'iu').test(text);
}

export type VerifiedVia = 'url' | 'domain' | 'ticker';

/** Text check: domain, venue-tied ticker, or a weak ticker plus the name. */
export function verifyText(text: string, ids: AccountIdentifiers): VerifiedVia | null {
  if (ids.domain && mentionsDomain(text, ids.domain)) return 'domain';
  if (ids.ticker) {
    const m = tickerMention(text, ids.ticker, ids.exchange);
    if (m === 'strong') return 'ticker';
    // A cashtag plus the name only helps when the name is not the symbol itself ($NOS + "NOS" proves nothing).
    const core = ids.companyName.replace(NAME_STOP, ' ').replace(/\s+/g, ' ').trim().toUpperCase();
    if (m === 'weak' && core !== ids.ticker && mentionsName(text, ids.companyName)) return 'ticker';
  }
  return null;
}

/** Evergreen quote and screener pages that search feeds return as "news". */
const QUOTE_PAGE = /(stock price,? news,? quote|quote (?:&|and) history|stock analysis - simply wall|seasonal returns? chart|trading opportunities|stock quote|share price (?:&|and) news|price target history|stock forecast|historical prices|options chain)/i;
export const isQuotePage = (title: string) => QUOTE_PAGE.test(title);

// ── Article body ──────────────────────────────────────────────────────────

export interface BodyFetch {
  (url: string, init: { headers: Record<string, string>; signal: AbortSignal; redirect?: 'follow' | 'manual' }): Promise<{
    ok: boolean;
    status: number;
    headers?: { get(name: string): string | null };
    body?: ReadableStream<Uint8Array> | null;
    text(): Promise<string>;
  }>;
}

export interface BodyCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
}

export const ARTICLE_TIMEOUT_MS = 6_000;
export const ARTICLE_MAX_BYTES = 400_000;

/** Literal private, loopback and link-local hosts are never fetched. */
export function isPublicHttpUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  if (u.username || u.password) return false;
  if (u.port && u.port !== '80' && u.port !== '443') return false;
  const h = u.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return false;
  if (h.includes(':') || h.startsWith('[')) return false; // IPv6 literal
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
  }
  return true;
}

/** Reads at most `max` bytes, then cancels the stream. */
export async function readCapped(res: Awaited<ReturnType<BodyFetch>>, max: number): Promise<string> {
  const body = res.body;
  if (!body || typeof body.getReader !== 'function') return (await res.text()).slice(0, max);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < max) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      size += value.byteLength;
    }
  } finally {
    reader.cancel().catch(() => undefined);
  }
  const buf = new Uint8Array(Math.min(size, max));
  let off = 0;
  for (const c of chunks) {
    const take = Math.min(c.byteLength, buf.length - off);
    buf.set(c.subarray(0, take), off);
    off += take;
    if (off >= buf.length) break;
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(buf);
}

/** robots.txt rules for our agent (or *): longest matching rule wins. */
export function robotsAllows(robots: string, path: string, agentToken: string): boolean {
  const groups: Array<{ agents: string[]; rules: Array<{ allow: boolean; path: string }> }> = [];
  let cur: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const raw of robots.split(/\r?\n/).slice(0, 2000)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const val = m[2]!.trim();
    if (key === 'user-agent') {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], rules: [] };
        groups.push(cur);
      }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
    } else if ((key === 'allow' || key === 'disallow') && cur) {
      lastWasAgent = false;
      if (key === 'disallow' && val === '') continue;
      cur.rules.push({ allow: key === 'allow', path: val });
    } else lastWasAgent = false;
  }
  const token = agentToken.toLowerCase();
  const mine = groups.filter((g) => g.agents.some((a) => a !== '*' && token.includes(a)));
  const use = mine.length ? mine : groups.filter((g) => g.agents.includes('*'));
  let best: { allow: boolean; len: number } | null = null;
  for (const r of use.flatMap((g) => g.rules)) {
    const re = new RegExp(`^${r.path.split('*').map(esc).join('.*').replace(/\\\$$/, '$')}`);
    if (re.test(path) && (!best || r.path.length > best.len || (r.path.length === best.len && r.allow))) best = { allow: r.allow, len: r.path.length };
  }
  return best ? best.allow : true;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** HTML to plain text without executing anything: drop scripts, styles and tags. */
export function htmlToText(html: string): string {
  const meta = [...html.matchAll(/<meta\b[^>]*\b(?:name|property)=["'](?:description|og:description|og:title)["'][^>]*>/gi)]
    .map((m) => /\bcontent=["']([^"']*)["']/i.exec(m[0])?.[1] ?? '')
    .join(' ');
  const body = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template|svg|iframe)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]{0,2000}>/g, ' ');
  return `${meta} ${body}`
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
      if (e[0] === '#') {
        const n = e[1]?.toLowerCase() === 'x' ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10);
        return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ' ';
      }
      return ENTITIES[e.toLowerCase()] ?? all;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

export interface BodyCheckDeps {
  fetchImpl: BodyFetch;
  cache: BodyCache;
  ttl: number;
  userAgent: string;
}

/**
 * Fetch the article (robots permitting) and verify it in the body text.
 * Verdicts are cached per URL and identifiers, never the page itself.
 */
export async function verifyArticleBody(url: string, ids: AccountIdentifiers, deps: BodyCheckDeps): Promise<VerifiedVia | null> {
  if (!isPublicHttpUrl(url)) return null;
  const u = new URL(url);
  if (/(^|\.)news\.google\.com$/.test(u.hostname)) return null; // redirect pages, no article text
  const key = `body:${url.slice(0, 400)}|${ids.domain ?? ''}|${ids.ticker ?? ''}|${ids.exchange ?? ''}`;
  const hit = await deps.cache.get(key);
  if (hit !== null) return (hit || null) as VerifiedVia | null;
  const headers = { 'User-Agent': deps.userAgent, Accept: 'text/html,application/xhtml+xml;q=0.9,text/plain;q=0.5' };
  const get = async (target: string) => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), ARTICLE_TIMEOUT_MS);
    try {
      const res = await deps.fetchImpl(target, { headers, signal: ac.signal, redirect: 'follow' });
      return { res, text: res.ok ? await readCapped(res, ARTICLE_MAX_BYTES) : '' };
    } finally {
      clearTimeout(timer);
    }
  };
  let verdict: VerifiedVia | null = null;
  try {
    const robotsKey = `robots:${u.origin}`;
    let robots = await deps.cache.get(robotsKey);
    if (robots === null) {
      try {
        const r = await get(`${u.origin}/robots.txt`);
        // RFC 9309: 4xx means no rules; 5xx or a network error means stay out.
        robots = r.res.ok ? r.text.slice(0, 100_000) : r.res.status >= 400 && r.res.status < 500 ? '' : 'User-agent: *\nDisallow: /';
      } catch {
        robots = 'User-agent: *\nDisallow: /';
      }
      await deps.cache.set(robotsKey, robots, deps.ttl);
    }
    const token = deps.userAgent.split(/[\s/(]/)[0] || 'Polo';
    if (robotsAllows(robots, u.pathname + u.search, token)) {
      const { res, text } = await get(url);
      const type = res.headers?.get('content-type') ?? 'text/html';
      if (res.ok && /html|text\/plain/i.test(type)) verdict = verifyText(htmlToText(text), ids);
    }
  } catch {
    verdict = null;
  }
  await deps.cache.set(key, verdict ?? '', deps.ttl);
  return verdict;
}

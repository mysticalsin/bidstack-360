/**
 * Polite HTTP client for account intelligence (slice 12).
 *
 * Every request identifies Polo with a User-Agent that names a contact,
 * checks robots.txt once per host, waits between requests to the same host
 * and caches successful answers. Nothing here logs in or sends cookies.
 */
import { assertPublicHttpUrl } from '@bidstack/shared';

import { createResearchFetch } from '../safe-research-fetch.js';
import { ALLOW_ALL, parseRobots, robotsAllows, type RobotsRules } from './robots.js';

/** Minimal response the client needs. */
export interface IntelFetchResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

/** Fetch seam: production wraps the SSRF-guarded fetch, tests pass a recorder. */
export type IntelFetch = (url: string, init?: IntelFetchInit) => Promise<IntelFetchResponse>;

/** Request options passed to the fetch seam. */
export interface IntelFetchInit {
  headers?: Record<string, string>;
  method?: 'GET' | 'POST';
  body?: string;
  /** Stop reading the body past this many bytes. */
  maxBytes?: number;
  /** Called before following a redirect; throw to refuse the hop (robots.txt). */
  beforeRedirect?: (url: string) => Promise<void>;
}

const SECRET_PARAMS = /^(app_key|app_id|api_key|apikey|key|token|access_token|api_token)$/i;

/** URL with credential query parameters masked, safe for logs and run details. */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) if (SECRET_PARAMS.test(k)) u.searchParams.set(k, 'REDACTED');
    return u.toString();
  } catch {
    return url;
  }
}

/** The URL when it is http or https, else null. Guards every stored link. */
export function webUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/** One cached answer. */
export interface IntelCacheEntry {
  status: number;
  body: string;
  at: number;
}

/** Response cache seam. */
export interface IntelCache {
  get(key: string): IntelCacheEntry | null;
  set(key: string, value: IntelCacheEntry): void;
}

/** Thrown when robots.txt disallows the path for our User-Agent. Never retried. */
export class RobotsDisallowedError extends Error {
  readonly url: string;
  constructor(url: string) {
    super(`robots.txt disallows ${redactUrl(url)}`);
    this.name = 'RobotsDisallowedError';
    this.url = redactUrl(url);
  }
}

/** Thrown for an HTTP error status. Carries a short body excerpt for diagnostics. */
export class IntelHttpError extends Error {
  readonly url: string;
  constructor(
    url: string,
    readonly status: number,
    readonly bodyExcerpt: string,
  ) {
    super(`HTTP ${status} for ${redactUrl(url)}`);
    this.name = 'IntelHttpError';
    this.url = redactUrl(url);
  }
}

/** Options for one GET. */
export interface IntelGetOptions {
  headers?: Record<string, string>;
  accept?: string;
  /** Body size limit for this request (default 3 MB). */
  maxBytes?: number;
  /** Skip the response cache (large documents). */
  noCache?: boolean;
}

/** Polite client. */
export interface IntelClient {
  readonly userAgent: string;
  get(url: string, opts?: IntelGetOptions): Promise<string>;
  /** JSON POST for licensed search APIs. Robots-checked, paced, never cached. */
  postJson(url: string, body: unknown, opts?: IntelGetOptions): Promise<string>;
  robots(origin: string): Promise<RobotsRules>;
}

const DEFAULT_TTL_MS = 6 * 3_600_000;
const MAX_BODY = 3_000_000;
/** Total cached body size; oldest entries are evicted past it. */
const MAX_CACHE_CHARS = 50_000_000;
/** Bodies larger than this are never cached. */
const MAX_CACHED_ENTRY = 1_000_000;

/** In-memory cache with a TTL, bounded by total body size. */
export function memoryIntelCache(now: () => number = Date.now, ttlMs = DEFAULT_TTL_MS, maxChars = MAX_CACHE_CHARS): IntelCache {
  const map = new Map<string, IntelCacheEntry>();
  let total = 0;
  const drop = (key: string) => {
    const hit = map.get(key);
    if (hit) total -= hit.body.length;
    map.delete(key);
  };
  return {
    get(key) {
      const hit = map.get(key);
      if (!hit) return null;
      if (now() - hit.at > ttlMs) {
        drop(key);
        return null;
      }
      return hit;
    },
    set(key, value) {
      if (value.body.length > MAX_CACHED_ENTRY) return;
      drop(key);
      while (map.size && total + value.body.length > maxChars) drop(map.keys().next().value as string);
      map.set(key, { ...value, at: now() });
      total += value.body.length;
    },
  };
}

/**
 * The User-Agent to send, from ACCOUNT_INTEL_USER_AGENT or SEC_USER_AGENT.
 * Null unless it names a contact (an email address or a URL).
 */
export function intelUserAgent(env: Record<string, string | undefined>): string | null {
  for (const v of [env.ACCOUNT_INTEL_USER_AGENT, env.SEC_USER_AGENT]) {
    const ua = v?.trim();
    if (ua && (ua.includes('@') || /https?:\/\//i.test(ua))) return ua;
  }
  return null;
}

function productToken(ua: string): string {
  return (ua.split(/[\s/]/)[0] ?? ua).toLowerCase();
}

/** Build the polite client. */
export function createIntelClient(opts: {
  fetchImpl: IntelFetch;
  userAgent: string;
  cache?: IntelCache;
  minGapMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}): IntelClient {
  const cache = opts.cache ?? memoryIntelCache();
  const gap = opts.minGapMs ?? 1000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const lastHit = new Map<string, number>();
  const robotsByOrigin = new Map<string, Promise<RobotsRules>>();
  const token = productToken(opts.userAgent);

  async function pace(host: string): Promise<void> {
    const last = lastHit.get(host);
    if (last != null && gap > 0) {
      const wait = last + gap - now();
      if (wait > 0) await sleep(wait);
    }
    lastHit.set(host, now());
  }

  async function raw(url: string, headers: Record<string, string>, post?: string, maxBytes = MAX_BODY): Promise<IntelFetchResponse> {
    await pace(new URL(url).host);
    const init: IntelFetchInit = {
      headers: { 'User-Agent': opts.userAgent, ...headers },
      maxBytes,
      beforeRedirect: async (next) => {
        await allowed(next);
        await pace(new URL(next).host);
      },
    };
    return opts.fetchImpl(url, post === undefined ? init : { ...init, method: 'POST', body: post });
  }

  async function allowed(url: string): Promise<URL> {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error(`unsupported URL ${redactUrl(url)}`);
    const rules = await robots(u.origin);
    if (!robotsAllows(rules, token, `${u.pathname}${u.search}`)) throw new RobotsDisallowedError(url);
    return u;
  }

  function robots(origin: string): Promise<RobotsRules> {
    let p = robotsByOrigin.get(origin);
    if (!p) {
      p = (async () => {
        try {
          await pace(new URL(origin).host);
          const res = await opts.fetchImpl(`${origin}/robots.txt`, { headers: { 'User-Agent': opts.userAgent, Accept: 'text/plain' }, maxBytes: 500_000 });
          if (res.ok) return parseRobots((await res.text()).slice(0, 500_000));
          // RFC 9309: unreachable (5xx) means assume complete disallow; 4xx means no rules.
          return res.status >= 500 ? { ...ALLOW_ALL, disallowAll: true } : ALLOW_ALL;
        } catch {
          return { ...ALLOW_ALL, disallowAll: true };
        }
      })();
      robotsByOrigin.set(origin, p);
    }
    return p;
  }

  return {
    userAgent: opts.userAgent,
    robots,
    async get(url, o = {}) {
      const hit = o.noCache ? null : cache.get(url);
      if (hit) return hit.body;
      await allowed(url);
      const max = o.maxBytes ?? MAX_BODY;
      const res = await raw(url, { Accept: o.accept ?? '*/*', ...(o.headers ?? {}) }, undefined, max);
      const body = (await res.text()).slice(0, max);
      if (!res.ok) throw new IntelHttpError(url, res.status, body.slice(0, 300));
      if (!o.noCache) cache.set(url, { status: res.status, body, at: now() });
      return body;
    },
    async postJson(url, payload, o = {}) {
      await allowed(url);
      const res = await raw(url, { Accept: o.accept ?? 'application/json', 'Content-Type': 'application/json', ...(o.headers ?? {}) }, JSON.stringify(payload));
      const body = (await res.text()).slice(0, MAX_BODY);
      if (!res.ok) throw new IntelHttpError(url, res.status, body.slice(0, 300));
      return body;
    },
  };
}

/** Read at most `maxBytes` of a body, then cancel the stream. */
async function readCapped(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  if (size >= maxBytes) await reader.cancel().catch(() => undefined);
  const buf = new Uint8Array(Math.min(size, maxBytes));
  let off = 0;
  for (const c of chunks) {
    const part = c.subarray(0, Math.min(c.byteLength, buf.byteLength - off));
    buf.set(part, off);
    off += part.byteLength;
    if (off >= buf.byteLength) break;
  }
  return new TextDecoder().decode(buf);
}

const CREDENTIAL_HEADERS = /^(authorization|x-api-key|api-key|x-auth-token)$/i;

/**
 * Production fetch: SSRF and DNS guarded, follows at most 3 redirects and
 * re-validates each hop. No cookies. Credential headers never follow a
 * redirect to another origin; 303 (and 301/302 after POST) switch to GET.
 * Bodies are streamed and cut at `maxBytes`.
 */
export function defaultIntelFetch(timeoutMs = 15_000): IntelFetch {
  const guarded = createResearchFetch(fetch);
  return async (url, init) => {
    let target = url;
    let method = init?.method ?? 'GET';
    let body = init?.body;
    let headers = { ...(init?.headers ?? {}) };
    const max = init?.maxBytes ?? MAX_BODY;
    for (let hop = 0; hop < 4; hop++) {
      const res = await guarded(target, { method, body, headers, redirect: 'manual', credentials: 'omit', signal: AbortSignal.timeout(timeoutMs) });
      const loc = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
      if (!loc) return { ok: res.ok, status: res.status, text: () => readCapped(res, max) };
      await res.body?.cancel().catch(() => undefined);
      const next = assertPublicHttpUrl(new URL(loc, target).toString()).toString();
      if (new URL(next).origin !== new URL(target).origin) {
        headers = Object.fromEntries(Object.entries(headers).filter(([k]) => !CREDENTIAL_HEADERS.test(k)));
      }
      if (res.status === 303 || (method === 'POST' && (res.status === 301 || res.status === 302))) {
        method = 'GET';
        body = undefined;
        delete headers['Content-Type'];
      }
      if (init?.beforeRedirect) await init.beforeRedirect(next);
      target = next;
    }
    throw new Error(`too many redirects for ${redactUrl(url)}`);
  };
}

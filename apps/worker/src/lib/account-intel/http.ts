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
export type IntelFetch = (url: string, init?: { headers?: Record<string, string>; method?: 'GET' | 'POST'; body?: string }) => Promise<IntelFetchResponse>;

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

/** In-memory cache with a TTL. */
export function memoryIntelCache(now: () => number = Date.now, ttlMs = DEFAULT_TTL_MS): IntelCache {
  const map = new Map<string, IntelCacheEntry>();
  return {
    get(key) {
      const hit = map.get(key);
      if (!hit) return null;
      if (now() - hit.at > ttlMs) {
        map.delete(key);
        return null;
      }
      return hit;
    },
    set(key, value) {
      if (map.size > 2000) map.delete(map.keys().next().value as string);
      map.set(key, { ...value, at: now() });
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

  async function raw(url: string, headers: Record<string, string>, post?: string): Promise<IntelFetchResponse> {
    await pace(new URL(url).host);
    const init = { headers: { 'User-Agent': opts.userAgent, ...headers } };
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
          const res = await raw(`${origin}/robots.txt`, { Accept: 'text/plain' });
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
      const hit = cache.get(url);
      if (hit) return hit.body;
      await allowed(url);
      const res = await raw(url, { Accept: o.accept ?? '*/*', ...(o.headers ?? {}) });
      const body = (await res.text()).slice(0, MAX_BODY);
      if (!res.ok) throw new IntelHttpError(url, res.status, body.slice(0, 300));
      cache.set(url, { status: res.status, body, at: now() });
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

/**
 * Production fetch: SSRF and DNS guarded, follows at most 3 redirects and
 * re-validates each hop. No cookies, no credentials.
 */
export function defaultIntelFetch(timeoutMs = 15_000): IntelFetch {
  const guarded = createResearchFetch(fetch);
  return async (url, init) => {
    let target = url;
    for (let hop = 0; hop < 4; hop++) {
      const res = await guarded(target, { method: init?.method ?? 'GET', body: init?.body, headers: init?.headers, redirect: 'manual', credentials: 'omit', signal: AbortSignal.timeout(timeoutMs) });
      const loc = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
      if (!loc) return { ok: res.ok, status: res.status, text: () => res.text() };
      target = assertPublicHttpUrl(new URL(loc, target).toString()).toString();
    }
    throw new Error(`too many redirects for ${url}`);
  };
}

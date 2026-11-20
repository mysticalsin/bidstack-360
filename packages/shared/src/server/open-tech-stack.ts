/**
 * Open data technology detector (slice 16), server side.
 *
 * Lanes, each public and keyless:
 *   dns     MX, SPF/TXT verification, NS and CNAME answers via node:dns
 *   ct      certificate transparency host names from crt.sh (cached, paced,
 *           with a cool-down after an outage)
 *   web     the public homepage, one page request after robots.txt
 *   jobs    public job postings already stored by account intel
 *   github  public repository languages when the homepage links one org
 *
 * HTTP goes through `publicGet`: string SSRF gate, then a DNS lookup that runs
 * at connect time and refuses private, loopback and metadata addresses. The
 * socket connects to the address that was checked, so a DNS rebind between
 * check and connect cannot reach internal space. Redirects are followed by
 * hand (at most 3) and every hop is checked again. No cookies, no logins.
 */
import { lookup as dnsLookup, type LookupAddress, type LookupOneOptions, type LookupAllOptions } from 'node:dns';
import { Resolver } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';

import type { TechnicalStackCoverageLane } from '../schemas/crm.base.js';
import {
  companySlug,
  ctHostsFromCrtSh,
  DNS_CNAME_PROBES,
  githubOrgFromHtml,
  matchCtHosts,
  matchDnsRecords,
  matchGithubLanguages,
  matchHomepage,
  matchJobPostings,
  type DnsRecords,
  type OpenTechDetection,
  type PostingText,
} from '../tech-stack/lanes.js';
import type { OpenTechRun } from '../tech-stack/snapshot.js';
import { assertPublicHttpUrl, isPublicHostname } from '../utils/index.js';

// ─── Public HTTP GET with connect-time address check ─────────────────────────

export interface PublicGetResponse {
  url: string;
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface PublicGetOptions {
  timeoutMs?: number;
  maxBytes?: number;
  headers?: Record<string, string>;
  maxRedirects?: number;
}

export type PublicGet = (url: string, opts?: PublicGetOptions) => Promise<PublicGetResponse>;

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/** dns.lookup that fails when any resolved address is not public. Used as the socket lookup. */
export function publicOnlyLookup(hostname: string, options: LookupOneOptions | LookupAllOptions | number, callback: LookupCallback): void {
  const opts = typeof options === 'number' ? { family: options } : options;
  dnsLookup(hostname, { ...opts, all: true }, (err, addresses) => {
    if (err) return callback(err, '');
    const list = addresses as LookupAddress[];
    if (list.length === 0) return callback(Object.assign(new Error(`No addresses for ${hostname}`), { code: 'ENOTFOUND' }), '');
    if (list.some((a) => !isPublicHostname(a.address))) {
      return callback(Object.assign(new Error('Host resolves to an internal address'), { code: 'EBLOCKED' }), '');
    }
    if ((opts as LookupAllOptions).all) return callback(null, list);
    const first = list[0]!;
    callback(null, first.address, first.family);
  });
}

function once(url: URL, opts: Required<Pick<PublicGetOptions, 'timeoutMs' | 'maxBytes'>> & { headers: Record<string, string> }): Promise<PublicGetResponse> {
  const lib = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(
      url,
      { method: 'GET', headers: { 'Accept-Encoding': 'identity', ...opts.headers }, lookup: publicOnlyLookup as never, timeout: opts.timeoutMs },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          if (size >= opts.maxBytes) return;
          chunks.push(chunk);
          size += chunk.length;
          if (size >= opts.maxBytes) res.destroy();
        });
        const done = () => {
          const headers: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) headers[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v);
          resolve({ url: url.toString(), status: res.statusCode ?? 0, headers, body: Buffer.concat(chunks).subarray(0, opts.maxBytes).toString('utf8') });
        };
        res.on('end', done);
        res.on('close', done);
        res.on('error', reject);
      },
    );
    const timer = setTimeout(() => req.destroy(new Error(`timeout after ${opts.timeoutMs} ms`)), opts.timeoutMs);
    req.on('timeout', () => req.destroy(new Error(`timeout after ${opts.timeoutMs} ms`)));
    req.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    req.on('close', () => clearTimeout(timer));
    req.end();
  });
}

/** SSRF-safe GET: public http(s) only, connect-time address check, manual redirects, size and time caps. */
export const publicGet: PublicGet = async (rawUrl, o = {}) => {
  const opts = { timeoutMs: o.timeoutMs ?? 8_000, maxBytes: o.maxBytes ?? 1_500_000, headers: o.headers ?? {} };
  let url = assertPublicHttpUrl(rawUrl);
  for (let hop = 0; hop <= (o.maxRedirects ?? 3); hop++) {
    const res = await once(url, opts);
    const location = res.status >= 300 && res.status < 400 ? res.headers.location : undefined;
    if (!location) return res;
    url = assertPublicHttpUrl(new URL(location, url).toString());
  }
  throw new Error('too many redirects');
};

// ─── robots.txt (RFC 9309, minimal) ───────────────────────────────────────────

/** True when `token` may fetch `path` under this robots.txt body. */
export function robotsTxtAllows(body: string, token: string, path: string): boolean {
  const groups: Array<{ agents: string[]; rules: Array<{ allow: boolean; path: string }> }> = [];
  let cur: (typeof groups)[number] | null = null;
  let lastAgent = false;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const i = line.indexOf(':');
    if (i < 0) continue;
    const field = line.slice(0, i).trim().toLowerCase();
    const value = line.slice(i + 1).trim();
    if (field === 'user-agent') {
      if (!cur || !lastAgent) groups.push((cur = { agents: [], rules: [] }));
      cur.agents.push(value.toLowerCase());
      lastAgent = true;
      continue;
    }
    lastAgent = false;
    if (cur && (field === 'allow' || (field === 'disallow' && value))) cur.rules.push({ allow: field === 'allow', path: value });
  }
  const t = token.toLowerCase();
  const named = groups.filter((g) => g.agents.some((a) => a !== '*' && t.startsWith(a)));
  const chosen = named.length ? named : groups.filter((g) => g.agents.includes('*'));
  let best: { allow: boolean; path: string } | null = null;
  for (const g of chosen) {
    for (const r of g.rules) {
      const anchored = r.path.endsWith('$');
      const body = anchored ? r.path.slice(0, -1) : r.path;
      const re = new RegExp(`^${body.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}${anchored ? '$' : ''}`);
      if (!re.test(path)) continue;
      if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) best = r;
    }
  }
  return best ? best.allow : true;
}

// ─── crt.sh cache, pacing and outage cool-down ───────────────────────────────

const CT_TTL_MS = 7 * 24 * 3_600_000;
const CT_GAP_MS = 5_000;
const CT_COOLDOWN_MS = 15 * 60_000;
const CT_CACHE_MAX = 300;

export interface CrtShState {
  cache: Map<string, { at: number; body: string }>;
  nextAt: number;
  downUntil: number;
}

const sharedCtState: CrtShState = { cache: new Map(), nextAt: 0, downUntil: 0 };

/** Fresh crt.sh state, for tests. */
export function createCrtShState(): CrtShState {
  return { cache: new Map(), nextAt: 0, downUntil: 0 };
}

class LaneSkip extends Error {}

async function crtShQuery(q: string, deps: Required<Pick<TechDetectDeps, 'get' | 'now' | 'sleep' | 'userAgent'>> & { ct: CrtShState; timeoutMs: number }): Promise<string> {
  const url = `https://crt.sh/?q=${encodeURIComponent(q)}&output=json&exclude=expired`;
  const now = deps.now().getTime();
  const hit = deps.ct.cache.get(url);
  if (hit && now - hit.at < CT_TTL_MS) return hit.body;
  if (deps.ct.downUntil > now) throw new Error('crt.sh unavailable, cooling down');
  const wait = deps.ct.nextAt - now;
  deps.ct.nextAt = Math.max(now, deps.ct.nextAt) + CT_GAP_MS;
  if (wait > 0) await deps.sleep(wait);
  let res: PublicGetResponse;
  try {
    res = await deps.get(url, { timeoutMs: deps.timeoutMs, maxBytes: 3_000_000, headers: { 'User-Agent': deps.userAgent, Accept: 'application/json' } });
  } catch (err) {
    deps.ct.downUntil = deps.now().getTime() + CT_COOLDOWN_MS;
    throw new Error(`crt.sh unavailable: ${(err as Error).message}`.slice(0, 200), { cause: err });
  }
  if (res.status === 404) return '[]';
  if (res.status !== 200) {
    if (res.status >= 500 || res.status === 429) deps.ct.downUntil = deps.now().getTime() + CT_COOLDOWN_MS;
    throw new Error(`crt.sh answered HTTP ${res.status}`);
  }
  if (deps.ct.cache.size >= CT_CACHE_MAX) deps.ct.cache.delete(deps.ct.cache.keys().next().value as string);
  deps.ct.cache.set(url, { at: deps.now().getTime(), body: res.body });
  return res.body;
}

// ─── Detector ─────────────────────────────────────────────────────────────────

export interface DnsResolverLike {
  resolveMx(host: string): Promise<Array<{ exchange: string }>>;
  resolveTxt(host: string): Promise<string[][]>;
  resolveNs(host: string): Promise<string[]>;
  resolveCname(host: string): Promise<string[]>;
}

export interface TechDetectSubject {
  name: string;
  domain: string | null;
  website: string | null;
  githubOrg?: string | null;
  postings: PostingText[];
}

export interface TechDetectDeps {
  /** False skips every network lane (tests, BIDSTACK_OPEN_ENRICHMENT_DISABLED). Jobs still runs. */
  network?: boolean;
  resolver?: DnsResolverLike;
  get?: PublicGet;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  userAgent?: string;
  laneTimeoutMs?: number;
  ct?: CrtShState;
}

export const DEFAULT_TECH_DETECT_UA = 'PoloOpenTech/1.0 (+https://github.com/mysticalsin/bidstack-360)';

/** Contact User-Agent from env when it names one, else the default. */
export function techDetectUserAgent(env: Record<string, string | undefined>): string {
  const ua = env.ACCOUNT_INTEL_USER_AGENT?.trim();
  return ua && (ua.includes('@') || /https?:\/\//i.test(ua)) ? ua : DEFAULT_TECH_DETECT_UA;
}

function bareDomain(domain: string | null, website: string | null): string | null {
  const raw = domain ?? (website ? (() => { try { return new URL(website).hostname; } catch { return null; } })() : null);
  if (!raw) return null;
  const host = raw.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '').replace(/\.$/, '');
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null;
}

const quiet = async <T>(p: Promise<T>, fallback: T): Promise<T> => {
  try {
    return await p;
  } catch {
    return fallback;
  }
};

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    p.finally(() => clearTimeout(timer)),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
    }),
  ]);
}

/** Run every lane and report what each found. Never throws; a lane failure is a lane status. */
export async function detectOpenTechStack(subject: TechDetectSubject, deps: TechDetectDeps = {}): Promise<OpenTechRun & { githubOrg: string | null }> {
  const now = deps.now ?? (() => new Date());
  const observedAt = now().toISOString();
  const network = deps.network ?? true;
  const get = deps.get ?? publicGet;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const userAgent = deps.userAgent ?? DEFAULT_TECH_DETECT_UA;
  const laneTimeoutMs = deps.laneTimeoutMs ?? 15_000;
  const domain = bareDomain(subject.domain, subject.website);
  const lanes: TechnicalStackCoverageLane[] = [];
  const items: OpenTechDetection[] = [];
  let homepageHtml: string | null = null;

  const run = async (lane: TechnicalStackCoverageLane['lane'], fn: () => Promise<OpenTechDetection[]>) => {
    try {
      const found = await withTimeout(fn(), laneTimeoutMs, lane);
      items.push(...found);
      lanes.push({ lane, status: found.length ? 'found' : 'empty', count: found.length, detail: null, checkedAt: observedAt });
    } catch (err) {
      const skip = err instanceof LaneSkip;
      lanes.push({ lane, status: skip ? 'skipped' : 'failed', count: 0, detail: (err as Error).message.slice(0, 300), checkedAt: skip ? null : observedAt });
    }
  };
  const needNetwork = () => {
    if (!network) throw new LaneSkip('Network lanes are off in this environment');
    if (!domain) throw new LaneSkip('No domain on the account');
    return domain;
  };

  await Promise.all([
    run('dns', async () => {
      const d = needNetwork();
      const resolver = deps.resolver ?? new Resolver({ timeout: 3_000, tries: 2 });
      const [mx, txt, ns, cname] = await Promise.all([
        quiet(resolver.resolveMx(d), []),
        quiet(resolver.resolveTxt(d), []),
        quiet(resolver.resolveNs(d), []),
        Promise.all(DNS_CNAME_PROBES.map(async (sub) => (await quiet(resolver.resolveCname(`${sub}.${d}`), [])).map((target) => ({ host: `${sub}.${d}`, target })))),
      ]);
      const records: DnsRecords = { mx: mx.map((m) => m.exchange), txt: txt.map((parts) => parts.join('')), ns, cname: cname.flat() };
      if (!records.mx.length && !records.txt.length && !records.ns.length) throw new Error(`No DNS answers for ${d}`);
      return matchDnsRecords(d, records, observedAt);
    }),
    run('ct', async () => {
      const d = needNetwork();
      const ctDeps = { get, now, sleep, userAgent, ct: deps.ct ?? sharedCtState, timeoutMs: Math.max(1_000, laneTimeoutMs - 1_000) };
      const slug = companySlug(d);
      const own = ctHostsFromCrtSh(await crtShQuery(`%.${d}`, ctDeps));
      const tenant = slug ? ctHostsFromCrtSh(await quiet(crtShQuery(`${slug}.%`, ctDeps), '[]')) : [];
      return matchCtHosts(d, slug, [...own, ...tenant], observedAt);
    }),
    run('web', async () => {
      const d = needNetwork();
      const site = subject.website && bareDomain(null, subject.website) === d ? subject.website : `https://${d}/`;
      const origin = new URL(site).origin;
      const token = (userAgent.split(/[\s/]/)[0] ?? userAgent).toLowerCase();
      const robots = await get(`${origin}/robots.txt`, { timeoutMs: 5_000, maxBytes: 200_000, headers: { 'User-Agent': userAgent, Accept: 'text/plain' } }).catch(() => null);
      if (!robots || robots.status >= 500) throw new LaneSkip('robots.txt unreachable, homepage not fetched');
      const path = new URL(site).pathname || '/';
      if (robots.status === 200 && !robotsTxtAllows(robots.body, token, path)) throw new LaneSkip('robots.txt disallows the homepage');
      const page = await get(site, { timeoutMs: Math.min(8_000, laneTimeoutMs), maxBytes: 1_500_000, headers: { 'User-Agent': userAgent, Accept: 'text/html' } });
      if (page.status === 401 || page.status === 403 || page.status === 429) throw new Error(`Homepage answered HTTP ${page.status}, likely bot protection`);
      if (page.status !== 200) throw new Error(`Homepage answered HTTP ${page.status}`);
      homepageHtml = page.body;
      return matchHomepage({ url: page.url, html: page.body, headers: page.headers }, observedAt);
    }),
    run('jobs', async () => matchJobPostings(subject.postings, observedAt)),
  ]);

  let githubOrg = subject.githubOrg?.trim().toLowerCase() || null;
  if (!githubOrg && homepageHtml) githubOrg = githubOrgFromHtml(homepageHtml);
  await run('github', async () => {
    if (!network) throw new LaneSkip('Network lanes are off in this environment');
    if (!githubOrg || !/^[a-z0-9][a-z0-9-]{0,38}$/.test(githubOrg)) throw new LaneSkip('No public GitHub organisation linked');
    const res = await get(`https://api.github.com/orgs/${githubOrg}/repos?per_page=50&sort=pushed&type=public`, {
      timeoutMs: 8_000,
      maxBytes: 1_500_000,
      headers: { 'User-Agent': userAgent, Accept: 'application/vnd.github+json' },
    });
    if (res.status === 404) return [];
    if (res.status !== 200) throw new Error(`GitHub answered HTTP ${res.status}`);
    const repos: unknown = JSON.parse(res.body);
    return Array.isArray(repos) ? matchGithubLanguages(githubOrg, repos as Array<Record<string, unknown>>, observedAt) : [];
  });

  const order = ['dns', 'ct', 'web', 'jobs', 'github'];
  lanes.sort((a, b) => order.indexOf(a.lane) - order.indexOf(b.lane));
  return { checkedAt: observedAt, items, lanes, githubOrg };
}

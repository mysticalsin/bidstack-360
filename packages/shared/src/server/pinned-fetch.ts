// Pinned outbound fetch for server-side callers (API and worker).
//
// A public-looking name can resolve to a loopback, private, link-local, CGNAT
// or metadata address, and a second lookup can change the answer before the
// socket opens. This helper resolves once, refuses those addresses by parsing
// the IP (not by string prefix), and connects to that exact address with the
// original Host header and TLS server name. Redirects are manual: every hop is
// resolved and classified again, up to a fixed hop cap, with a size cap and a
// time cap. Node built-ins only.

import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import type { IncomingMessage } from 'node:http';
import type { RequestOptions } from 'node:https';
import type { Readable } from 'node:stream';

export type AddressBlock =
  | 'public'
  | 'private'
  | 'loopback'
  | 'link_local'
  | 'cgnat'
  | 'metadata'
  | 'ipv4_mapped'
  | 'unspecified'
  | 'reserved'
  | 'unparseable';

export type PinnedFetchErrorCode =
  | 'blocked_address'
  | 'dns'
  | 'redirect'
  | 'too_large'
  | 'timeout'
  | 'invalid_url'
  | 'too_many_redirects'
  | 'network';

export class PinnedFetchError extends Error {
  readonly code: PinnedFetchErrorCode;
  readonly block?: AddressBlock;

  constructor(code: PinnedFetchErrorCode, message: string, block?: AddressBlock, options?: { cause?: unknown }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'PinnedFetchError';
    this.code = code;
    this.block = block;
  }
}

export const PINNED_FETCH_DEFAULT_MAX_HOPS = 5;
export const PINNED_FETCH_DEFAULT_MAX_BYTES = 1_048_576;
export const PINNED_FETCH_DEFAULT_TIMEOUT_MS = 10_000;

export interface ResolvedAddress {
  address: string;
  family?: 4 | 6;
}

export type PinnedResolver = (hostname: string) => Promise<ResolvedAddress[]>;

export interface PinnedDial {
  protocol: 'http:' | 'https:';
  address: string;
  family: 4 | 6;
  port: number;
  servername: string | undefined;
  hostHeader: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  body: Uint8Array | null;
  timeoutMs: number;
  maxBytes: number;
}

export interface PinnedHopResult {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
}

export type PinnedTransport = (dial: PinnedDial) => Promise<PinnedHopResult>;

export interface PinnedFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array | null;
  /** `'error'` throws on 3xx. `'manual'` (default) follows up to `maxHops`, re-checking each hop. */
  redirect?: 'manual' | 'error';
  /** Redirects to follow. `0` returns the 3xx response. Ignored when `redirect` is `'error'`. */
  maxHops?: number;
  maxBytes?: number;
  timeoutMs?: number;
  resolve?: PinnedResolver;
  transport?: PinnedTransport;
  signal?: AbortSignal;
}

export interface PinnedFetchResponse {
  status: number;
  url: string;
  pinnedAddress: string;
  headers: { get(name: string): string | null };
  body: Uint8Array;
  text(): Promise<string>;
  toResponse(): Response;
}

interface MinimalRequest {
  write(chunk: Uint8Array): void;
  end(): void;
  destroy(error?: Error): void;
  on(event: string, listener: (err: Error) => void): void;
}

type RequestFn = (
  protocol: 'http:' | 'https:',
  options: RequestOptions,
  callback: (res: IncomingMessage) => void,
) => MinimalRequest;

function bareAddress(raw: string): string {
  let text = raw.trim().toLowerCase();
  if (text.startsWith('[') && text.endsWith(']')) text = text.slice(1, -1);
  const zone = text.indexOf('%');
  if (zone !== -1) text = text.slice(0, zone);
  return text;
}

function parseDottedV4(text: string): [number, number, number, number] | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (!match) return null;
  const octets = [match[1], match[2], match[3], match[4]].map((part) => Number(part)) as [
    number,
    number,
    number,
    number,
  ];
  return octets.every((n) => n <= 255) ? octets : null;
}

/** Expand an IPv6 literal, including compression and a trailing IPv4, to 8 groups. */
function parseV6(raw: string): number[] | null {
  let text = bareAddress(raw);
  const lastColon = text.lastIndexOf(':');
  const tail = text.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = parseDottedV4(tail);
    if (!v4) return null;
    const hi = ((v4[0] << 8) | v4[1]).toString(16);
    const lo = ((v4[2] << 8) | v4[3]).toString(16);
    text = `${text.slice(0, lastColon + 1)}${hi}:${lo}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const parseGroups = (part: string): number[] | null => {
    if (part === '') return [];
    const groups = part.split(':');
    if (!groups.every((group) => /^[0-9a-f]{1,4}$/.test(group))) return null;
    return groups.map((group) => Number.parseInt(group, 16));
  };
  const head = parseGroups(halves[0] ?? '');
  const rest = halves.length === 2 ? parseGroups(halves[1] ?? '') : [];
  if (!head || !rest) return null;
  const explicit = head.length + rest.length;
  if (halves.length === 1) return explicit === 8 ? head : null;
  if (explicit > 7) return null;
  return [...head, ...new Array<number>(8 - explicit).fill(0), ...rest];
}

function classifyV4(octets: [number, number, number, number]): AddressBlock {
  const [a, b, c, d] = octets;
  if (a === 0 && b === 0 && c === 0 && d === 0) return 'unspecified';
  if (a === 0) return 'reserved';
  if (a === 127) return 'loopback';
  if (a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)) return 'private';
  if (a === 169 && b === 254 && c === 169 && d === 254) return 'metadata';
  if (a === 169 && b === 254) return 'link_local';
  if (a === 100 && b >= 64 && b <= 127) return 'cgnat';
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return 'reserved';
  if (a === 198 && (b === 18 || b === 19)) return 'reserved';
  if (a === 198 && b === 51 && c === 100) return 'reserved';
  if (a === 203 && b === 0 && c === 113) return 'reserved';
  if (a >= 224) return 'reserved';
  return 'public';
}

function embeddedV4(hi: number, lo: number): [number, number, number, number] {
  return [(hi >>> 8) & 0xff, hi & 0xff, (lo >>> 8) & 0xff, lo & 0xff];
}

function classifyV6(groups: number[]): AddressBlock {
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = groups;
  const firstFiveZero = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0;
  if (firstFiveZero && g5 === 0 && g6 === 0 && g7 === 0) return 'unspecified';
  if (firstFiveZero && g5 === 0 && g6 === 0 && g7 === 1) return 'loopback';
  // Refuse the whole mapped and compatible range. A public embedded address
  // such as ::ffff:8.8.8.8 is still not a routable IPv6 destination, and a
  // private one would slip past a check that only looked at the text.
  if (firstFiveZero && (g5 === 0xffff || g5 === 0)) return 'ipv4_mapped';
  if (g0 === 0x64 && g1 === 0xff9b) {
    if (g2 === 1) return 'reserved';
    if (g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) return classifyV4(embeddedV4(g6, g7));
  }
  if (g0 === 0xfd00 && g1 === 0x0ec2 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0 && g6 === 0 && g7 === 0x254) {
    return 'metadata';
  }
  if ((g0 & 0xfe00) === 0xfc00) return 'private';
  if ((g0 & 0xffc0) === 0xfe80) return 'link_local';
  if ((g0 & 0xffc0) === 0xfec0) return 'reserved';
  if ((g0 & 0xff00) === 0xff00) return 'reserved';
  if (g0 === 0x2001 && g1 === 0x0db8) return 'reserved';
  if (g0 === 0x0100 && g1 === 0 && g2 === 0 && g3 === 0) return 'reserved';
  return 'public';
}

/** Classify one IP literal. Hostnames return `unparseable` (they are not addresses). */
export function classifyIpAddress(raw: string): AddressBlock {
  const bare = bareAddress(raw);
  const v4 = parseDottedV4(bare);
  if (v4) return classifyV4(v4);
  if (!bare.includes(':')) return 'unparseable';
  const groups = parseV6(bare);
  if (!groups) return 'unparseable';
  return classifyV6(groups);
}

function addressFamily(address: string): 4 | 6 {
  return address.includes(':') ? 6 : 4;
}

function isBlockedName(hostname: string): boolean {
  const name = bareAddress(hostname).replace(/\.$/, '');
  return (
    name === 'localhost' ||
    name.endsWith('.localhost') ||
    name.endsWith('.local') ||
    name.endsWith('.internal') ||
    name.endsWith('.home.arpa') ||
    name === 'metadata' ||
    name === 'instance-data'
  );
}

function blocked(block: AddressBlock): never {
  throw new PinnedFetchError('blocked_address', 'URL resolves to a blocked address', block);
}

async function defaultResolve(hostname: string): Promise<ResolvedAddress[]> {
  try {
    const records = await lookup(hostname, { all: true, verbatim: true });
    return records.map((record) => ({ address: record.address, family: record.family === 6 ? 6 : 4 }));
  } catch (err) {
    throw new PinnedFetchError('dns', 'DNS resolution failed', undefined, { cause: err });
  }
}

async function resolvePinned(hostname: string, resolve: PinnedResolver): Promise<{ address: string; family: 4 | 6 }> {
  const bare = bareAddress(hostname);
  const literal = classifyIpAddress(bare);
  if (literal !== 'unparseable') {
    if (literal !== 'public') blocked(literal);
    return { address: bare, family: addressFamily(bare) };
  }
  if (isBlockedName(bare)) blocked('reserved');
  let answers: ResolvedAddress[];
  try {
    answers = await resolve(bare);
  } catch (err) {
    if (err instanceof PinnedFetchError) throw err;
    throw new PinnedFetchError('dns', 'DNS resolution failed', undefined);
  }
  if (answers.length === 0) throw new PinnedFetchError('dns', 'DNS resolution failed');
  let chosen: { address: string; family: 4 | 6 } | null = null;
  for (const answer of answers) {
    const block = classifyIpAddress(answer.address);
    if (block !== 'public') blocked(block);
    if (!chosen) chosen = { address: bareAddress(answer.address), family: addressFamily(answer.address) };
  }
  if (!chosen) throw new PinnedFetchError('dns', 'DNS resolution failed');
  return chosen;
}

function hostHeaderFor(hostname: string, port: string, protocol: 'http:' | 'https:'): string {
  const bare = bareAddress(hostname);
  const display = bare.includes(':') ? `[${bare}]` : bare;
  const defaultPort = protocol === 'https:' ? '443' : '80';
  if (!port || port === defaultPort) return display;
  return `${display}:${port}`;
}

function serverNameFor(hostname: string): string | undefined {
  const bare = bareAddress(hostname);
  return classifyIpAddress(bare) === 'unparseable' ? bare : undefined;
}

export function pinnedSocketOptions(dial: PinnedDial): RequestOptions {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(dial.headers)) {
    if (key.toLowerCase() === 'host') continue;
    headers[key.toLowerCase()] = value;
  }
  headers.host = dial.hostHeader;
  const options: RequestOptions = {
    host: dial.address,
    family: dial.family,
    port: dial.port,
    method: dial.method,
    path: dial.path || '/',
    headers,
    setHost: false,
    timeout: dial.timeoutMs,
  };
  if (dial.protocol === 'https:' && dial.servername) options.servername = dial.servername;
  return options;
}

function headerText(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value.join(', ') : value;
}

function flattenHeaders(headers: IncomingMessage['headers']): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const text = headerText(value);
    if (text !== undefined) out[key.toLowerCase()] = text;
  }
  return out;
}

/** Read until `maxBytes`. A larger body destroys the stream and throws. */
export async function readBounded(stream: Readable, maxBytes: number): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    if (size + buf.length > maxBytes) {
      stream.destroy();
      throw new PinnedFetchError('too_large', 'Response exceeds the size cap');
    }
    chunks.push(buf);
    size += buf.length;
  }
  return new Uint8Array(Buffer.concat(chunks));
}

function defaultRequest(protocol: 'http:' | 'https:', options: RequestOptions, callback: (res: IncomingMessage) => void): MinimalRequest {
  const req = protocol === 'https:' ? https.request(options, callback) : http.request(options, callback);
  return req;
}

export function nodePinnedTransport(dial: PinnedDial, deps?: { request?: RequestFn }): Promise<PinnedHopResult> {
  const request = deps?.request ?? defaultRequest;
  const options = pinnedSocketOptions(dial);
  return new Promise((resolve, reject) => {
    let settled = false;
    const pending: { timer?: ReturnType<typeof setTimeout> } = {};
    const finish = (err?: Error, hop?: PinnedHopResult) => {
      if (settled) return;
      settled = true;
      if (pending.timer) clearTimeout(pending.timer);
      if (err) reject(err);
      else if (hop) resolve(hop);
    };
    const req = request(dial.protocol, options, (res) => {
      const declared = Number(headerText(res.headers['content-length']) ?? '');
      if (Number.isFinite(declared) && declared > dial.maxBytes) {
        res.destroy();
        req.destroy();
        finish(new PinnedFetchError('too_large', 'Response exceeds the size cap'));
        return;
      }
      readBounded(res, dial.maxBytes).then(
        (body) => finish(undefined, { status: res.statusCode ?? 0, headers: flattenHeaders(res.headers), body }),
        (err: unknown) => finish(err instanceof PinnedFetchError ? err : new PinnedFetchError('network', 'Pinned fetch failed')),
      );
    });
    pending.timer = setTimeout(() => {
      const err = new PinnedFetchError('timeout', 'Pinned fetch timed out');
      req.destroy(err);
      finish(err);
    }, dial.timeoutMs);
    req.on('error', (err) => {
      finish(err instanceof PinnedFetchError ? err : new PinnedFetchError('network', 'Pinned fetch failed'));
    });
    if (dial.body && dial.body.byteLength > 0) req.write(dial.body);
    req.end();
  });
}

function withTimeout<T>(work: Promise<T>, timeoutMs: number, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new PinnedFetchError('timeout', 'Pinned fetch timed out'));
    }, timeoutMs);
    const onAbort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new PinnedFetchError('timeout', 'Pinned fetch aborted'));
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    work.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        reject(err);
      },
    );
  });
}

function headerRecord(init: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!init) return out;
  for (const [key, value] of Object.entries(init)) out[key.toLowerCase()] = value;
  return out;
}

function encodeBody(body: PinnedFetchOptions['body']): Uint8Array | null {
  if (body == null || body === '') return null;
  if (typeof body === 'string') return new Uint8Array(Buffer.from(body));
  return new Uint8Array(body);
}

function responseOf(url: string, address: string, hop: PinnedHopResult): PinnedFetchResponse {
  const headers = new Map<string, string>();
  for (const [key, value] of Object.entries(hop.headers)) headers.set(key.toLowerCase(), value);
  return {
    status: hop.status,
    url,
    pinnedAddress: address,
    headers: { get: (name) => headers.get(name.toLowerCase()) ?? null },
    body: hop.body,
    text: () => Promise.resolve(new TextDecoder('utf-8', { fatal: false }).decode(hop.body)),
    toResponse: () => new Response(Buffer.from(hop.body), { status: hop.status, headers: Object.fromEntries(headers) }),
  };
}

function parseHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new PinnedFetchError('invalid_url', 'URL is not valid');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new PinnedFetchError('invalid_url', 'URL protocol must be http or https');
  }
  if (url.username || url.password) throw new PinnedFetchError('invalid_url', 'URL must not carry credentials');
  return url;
}

/**
 * Fetch `rawUrl` on a socket pinned to one checked address.
 * Throws `PinnedFetchError` for a blocked address, a redirect the caller
 * refused, a body over the cap, or a hop that exceeds the time cap.
 */
export async function pinnedFetch(rawUrl: string, options: PinnedFetchOptions = {}): Promise<PinnedFetchResponse> {
  const resolve = options.resolve ?? defaultResolve;
  const transport = options.transport ?? ((dial: PinnedDial) => nodePinnedTransport(dial));
  const maxBytes = options.maxBytes ?? PINNED_FETCH_DEFAULT_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? PINNED_FETCH_DEFAULT_TIMEOUT_MS;
  const redirect = options.redirect ?? 'manual';
  const maxRedirects = redirect === 'error' ? 0 : (options.maxHops ?? PINNED_FETCH_DEFAULT_MAX_HOPS);
  let method = (options.method ?? 'GET').toUpperCase();
  let body = encodeBody(options.body);
  const headers = headerRecord(options.headers);
  let current = parseHttpUrl(rawUrl);
  const seen = new Set<string>();
  let followed = 0;

  for (;;) {
    const key = current.toString();
    if (seen.has(key)) throw new PinnedFetchError('too_many_redirects', 'Redirect loop');
    seen.add(key);
    const pinned = await resolvePinned(current.hostname, resolve);
    const protocol = current.protocol as 'http:' | 'https:';
    const dial: PinnedDial = {
      protocol,
      address: pinned.address,
      family: pinned.family,
      port: current.port ? Number(current.port) : protocol === 'https:' ? 443 : 80,
      servername: serverNameFor(current.hostname),
      hostHeader: hostHeaderFor(current.hostname, current.port, protocol),
      method,
      path: `${current.pathname}${current.search}`,
      headers,
      body,
      timeoutMs,
      maxBytes,
    };
    const hop = await withTimeout(transport(dial), timeoutMs, options.signal);
    if (hop.body.byteLength > maxBytes) throw new PinnedFetchError('too_large', 'Response exceeds the size cap');
    const isRedirect = hop.status >= 300 && hop.status < 400;
    if (!isRedirect) return responseOf(current.toString(), pinned.address, hop);
    if (redirect === 'error') throw new PinnedFetchError('redirect', 'Redirect refused');
    if (followed >= maxRedirects) {
      if (maxRedirects === 0) return responseOf(current.toString(), pinned.address, hop);
      throw new PinnedFetchError('too_many_redirects', 'Too many redirects');
    }
    const location = Object.entries(hop.headers).find(([name]) => name.toLowerCase() === 'location')?.[1];
    if (!location) throw new PinnedFetchError('redirect', 'Redirect is missing a Location header');
    let next: URL;
    try {
      next = parseHttpUrl(new URL(location, current).toString());
    } catch (err) {
      if (err instanceof PinnedFetchError) throw err;
      throw new PinnedFetchError('invalid_url', 'Redirect target is not a valid URL');
    }
    if (hop.status === 301 || hop.status === 302 || hop.status === 303) {
      method = 'GET';
      body = null;
    }
    followed += 1;
    current = next;
  }
}

// SSRF-hardened outbound fetch for SERVER-SIDE (Node) callers — API + worker.
//
// The web-safe SSRF helpers (assertPublicHttpUrl / isPublicHostname in
// ../utils) gate on the URL STRING only. This module closes the residual
// DNS-rebinding gap: it resolves the host and rejects if ANY resolved address
// is internal/loopback/metadata BEFORE the request is made. Node-only (uses
// node:dns), so it lives under '@bidstack/shared/server' and must never reach
// the web bundle.
//
// createSafeFetch dials through pinnedFetch, which connects to the address it
// just checked. assertUrlResolvesPublic remains for callers that only need the
// refusal and have not moved their socket onto the pin yet.

import { lookup } from 'node:dns/promises';

import { assertPublicHttpUrl, isPublicHostname } from '../index.js';
import { pinnedFetch, type PinnedResolver, type PinnedTransport } from './pinned-fetch.js';

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface SafeFetchOptions {
  resolve?: PinnedResolver;
  transport?: PinnedTransport;
}

function headerRecord(init: RequestInit['headers']): Record<string, string> {
  if (!init) return {};
  if (typeof Headers !== 'undefined' && init instanceof Headers) {
    const out: Record<string, string> = {};
    init.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }
  if (Array.isArray(init)) return Object.fromEntries(init);
  return { ...(init as Record<string, string>) };
}

function requestBody(body: RequestInit['body']): string | Uint8Array | null {
  if (body == null) return null;
  if (typeof body === 'string') return body;
  if (body instanceof Uint8Array) return body;
  throw new Error('createSafeFetch: unsupported body type');
}

/**
 * Validate that `rawUrl` is a public http(s) URL whose host resolves ONLY to
 * public addresses. Returns the parsed URL or throws — string gate first, then
 * the DNS-resolved-IP gate. Call before any server-side fetch of a tenant- or
 * user-controlled URL (webhooks, integration probes, document fetches).
 */
export async function assertUrlResolvesPublic(rawUrl: string): Promise<URL> {
  const url = assertPublicHttpUrl(rawUrl);
  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(url.hostname, { all: true });
  } catch (err) {
    throw new Error(`DNS resolution failed for ${url.hostname}`, { cause: err });
  }
  if (addresses.length === 0) {
    throw new Error(`No addresses resolved for ${url.hostname}`);
  }
  for (const { address } of addresses) {
    if (!isPublicHostname(address)) {
      throw new Error('URL resolves to an internal address');
    }
  }
  return url;
}

/**
 * Wrap a fetch so it refuses any URL — the initial one, and (when the caller
 * follows redirects manually and re-invokes this) every redirect hop — that
 * resolves to internal space. The DNS check runs before each request.
 *
 * Redirects MUST be handled manually by the caller. undici/fetch's default
 * (`redirect: 'follow'`, also what happens when `redirect` is omitted) would
 * transparently follow a 302 from a validated public host to an internal or
 * cloud-metadata address without ever re-running the DNS gate — an SSRF
 * bypass via redirect hop. To close that gap, this wrapper THROWS
 * synchronously unless the caller explicitly passes `redirect: 'manual'` or
 * `redirect: 'error'`; on `'manual'` the caller is responsible for reading
 * the `Location` header and re-validating it with `assertUrlResolvesPublic`
 * before following it.
 */
export function createSafeFetch(_baseFetch?: FetchLike, opts: SafeFetchOptions = {}): FetchLike {
  return (input, init) => {
    const redirect = init?.redirect ?? 'follow';
    if (redirect === 'follow') {
      throw new Error(
        "createSafeFetch: redirect 'follow' is unsafe (this is also the default when `redirect` is omitted) — a validated public host can respond with a redirect to an internal or cloud-metadata address, bypassing the SSRF gate. Pass { redirect: 'manual' } or { redirect: 'error' } and, for 'manual', re-validate the Location header with assertUrlResolvesPublic before following it.",
      );
    }
    return pinnedFetch(input.toString(), {
      method: init?.method,
      headers: headerRecord(init?.headers),
      body: requestBody(init?.body),
      redirect: redirect === 'error' ? 'error' : 'manual',
      maxHops: 0,
      signal: init?.signal ?? undefined,
      resolve: opts.resolve,
      transport: opts.transport,
      // Callers bound the wait with AbortSignal. This is only the ceiling.
      timeoutMs: 120_000,
    }).then((res) => res.toResponse());
  };
}

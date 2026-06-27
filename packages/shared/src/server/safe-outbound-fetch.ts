// SSRF-hardened outbound fetch for SERVER-SIDE (Node) callers — API + worker.
//
// The web-safe SSRF helpers (assertPublicHttpUrl / isPublicHostname in
// ../utils) gate on the URL STRING only. This module closes the residual
// DNS-rebinding gap: it resolves the host and rejects if ANY resolved address
// is internal/loopback/metadata BEFORE the request is made. Node-only (uses
// node:dns), so it lives under '@bidstack/shared/server' and must never reach
// the web bundle.
//
// Residual (documented): without a custom undici dispatcher we cannot pin the
// socket to the validated IP, so a sub-millisecond resolve->connect rebind is
// still theoretically possible. Resolve-and-validate is the standard, layered
// mitigation; if undici is added as a dep, upgrade to a connect-time IP check.

import { lookup } from 'node:dns/promises';

import { assertPublicHttpUrl, isPublicHostname } from '../index.js';

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

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
 */
export function createSafeFetch(baseFetch: FetchLike = fetch): FetchLike {
  return async (input, init) => {
    const url = await assertUrlResolvesPublic(input.toString());
    return baseFetch(url.toString(), init);
  };
}

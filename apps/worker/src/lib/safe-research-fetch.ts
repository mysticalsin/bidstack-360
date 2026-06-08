// SSRF-hardened fetch for competitor research.
//
// The shared competitor-intel core (`fetchGroundedDocuments`) is web-safe and so
// cannot use node:dns — it gates on the URL string and follows redirects
// manually, re-validating each hop. THIS wrapper closes the residual
// DNS-rebinding gap: before every hop it resolves the host and rejects if ANY
// resolved address is internal. The worker injects it as `fetchImpl`, so the
// DNS check runs for the initial URL AND every redirect target.
//
// Residual (documented): without a custom undici dispatcher we cannot pin the
// connection to the validated IP, so a sub-millisecond resolve→connect rebind is
// still theoretically possible. resolve-and-validate is the standard mitigation
// and is layered with the per-hop string gate. If `undici` is added as a dep,
// upgrade this to a dispatcher with a connect-time IP allow-check.

import { lookup } from 'node:dns/promises';

import { assertPublicHttpUrl, isPublicHostname } from '@bidstack/shared';

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

/**
 * Build a fetch that refuses any URL whose host (or any of its resolved IPs)
 * points at internal space. Throws before a request is made on a violation —
 * `fetchGroundedDocuments` treats a throw as "drop this document".
 */
export function createResearchFetch(baseFetch: FetchLike = fetch): FetchLike {
  return async (input, init) => {
    const url = assertPublicHttpUrl(input.toString());
    let addresses: Array<{ address: string }>;
    try {
      addresses = await lookup(url.hostname, { all: true });
    } catch {
      throw new Error(`DNS resolution failed for ${url.hostname}`);
    }
    if (addresses.length === 0) {
      throw new Error(`No addresses resolved for ${url.hostname}`);
    }
    for (const { address } of addresses) {
      if (!isPublicHostname(address)) {
        throw new Error('URL resolves to an internal address');
      }
    }
    return baseFetch(url.toString(), init);
  };
}

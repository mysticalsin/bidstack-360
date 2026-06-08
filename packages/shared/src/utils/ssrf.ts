/**
 * SSRF guard for outbound *research* fetches (competitor intel).
 *
 * The canonical `isPublicHostname` lives in `./webhook-url.ts` (already the
 * shared source of truth). This module reuses it and adds an http(s) URL guard
 * — webhook delivery is https-only, but research fetches public http(s) pages.
 *
 * Re-exported by `apps/api/src/lib/ssrf-guard.ts` so API routes and the worker
 * (which cannot import from `apps/api`) share one implementation.
 */

import { isPublicHostname } from './webhook-url.js';

/**
 * Parse and validate an outbound research URL. Throws if it is not an
 * `http(s)` URL pointing at a publicly routable host. Returns the parsed `URL`.
 *
 * This is the gate every competitor-research fetch must pass before a single
 * byte leaves the worker.
 */
export function assertPublicHttpUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`URL protocol must be http(s): ${rawUrl}`);
  }
  if (!isPublicHostname(url.hostname)) {
    throw new Error('URL must not point to an internal address');
  }
  return url;
}

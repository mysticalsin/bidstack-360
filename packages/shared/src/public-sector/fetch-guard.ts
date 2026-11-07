/**
 * Outbound fetch guard for public procurement sources (spec 6.2).
 *
 * Layered on the shared SSRF string gate (`assertPublicHttpUrl`). The worker
 * passes `createResearchFetch` or `createSafeFetch` as the fetch, which adds the
 * DNS-resolution check; this module adds a per-source host allowlist, https
 * only, GET only, no redirects, a size cap, and credential redaction.
 */

import { assertPublicHttpUrl } from '../utils/ssrf.js';
import { parseRetryAfterMs } from './backoff.js';
import { PsSourceError } from './errors.js';
import type { FetchLike } from './types.js';

export type { FetchLike } from './types.js';

/** Hosts the Chile adapters may call. Exact match, no wildcards. */
export const CHILE_SOURCE_HOSTS: readonly string[] = [
  'api.mercadopublico.cl',
  'transparenciachc.blob.core.windows.net',
];

/** Query parameters that carry credentials and must never be stored or logged. */
const SECRET_PARAMS = ['ticket', 'token', 'apikey', 'api_key', 'key', 'access_token'];

/** Default response cap (32 MiB). Bulk archives are streamed by the worker instead. */
export const DEFAULT_MAX_RESPONSE_BYTES = 32 * 1024 * 1024;

/** Replace credential query values with `REDACTED`. Safe on any input. */
export function redactUrl(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return '[invalid url]';
  }
  url.username = '';
  url.password = '';
  for (const name of [...url.searchParams.keys()]) {
    if (SECRET_PARAMS.includes(name.toLowerCase())) url.searchParams.set(name, 'REDACTED');
  }
  return url.toString();
}

/**
 * Validate a source URL: public http(s) host, on the allowlist, upgraded to
 * https. Throws `PsSourceError('blocked_url')` with a redacted message.
 */
export function assertAllowedSourceUrl(rawUrl: string, allowedHosts: readonly string[]): URL {
  let url: URL;
  try {
    url = assertPublicHttpUrl(rawUrl);
  } catch {
    throw new PsSourceError('blocked_url', `URL is internal or invalid: ${redactUrl(rawUrl)}`, {
      doNotRetry: true,
    });
  }
  const host = url.hostname.toLowerCase();
  if (!allowedHosts.includes(host) || url.port !== '' || url.username || url.password) {
    throw new PsSourceError('blocked_url', `Host not allowed for this source: ${host}`, {
      doNotRetry: true,
    });
  }
  url.protocol = 'https:';
  return url;
}

/** Result of a guarded GET. */
export interface GuardedResponse {
  httpStatus: number;
  contentType: string | null;
  body: Uint8Array;
  requestUrlRedacted: string;
}

async function readCapped(res: Response, maxBytes: number, redacted: string): Promise<Uint8Array> {
  const declared = Number(res.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new PsSourceError('too_large', `Response over ${maxBytes} bytes: ${redacted}`, {
      doNotRetry: true,
    });
  }
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new PsSourceError('too_large', `Response over ${maxBytes} bytes: ${redacted}`, {
        doNotRetry: true,
      });
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/**
 * GET one allowlisted URL. Never follows redirects, maps 429 to
 * `rate_limited` (honouring `Retry-After`), and never lets the request URL or
 * an underlying error message (which may contain a credential) escape.
 */
export async function guardedGet(
  fetch: FetchLike,
  rawUrl: string,
  opts: { allowedHosts: readonly string[]; maxBytes?: number; accept?: string; now?: () => Date },
): Promise<GuardedResponse> {
  const url = assertAllowedSourceUrl(rawUrl, opts.allowedHosts);
  const redacted = redactUrl(url.toString());
  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method: 'GET',
      redirect: 'manual',
      headers: { accept: opts.accept ?? 'application/json' },
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : 'Error';
    throw new PsSourceError('network', `Network error (${name}) for ${redacted}`);
  }

  const status = res.status;
  if (res.type === 'opaqueredirect' || (status >= 300 && status < 400)) {
    throw new PsSourceError('redirect_refused', `Redirect refused (HTTP ${status}) for ${redacted}`, {
      doNotRetry: true,
      httpStatus: status,
    });
  }
  if (status === 429) {
    const now = opts.now?.() ?? new Date();
    throw new PsSourceError('rate_limited', `HTTP 429 for ${redacted}`, {
      retryAfterMs: parseRetryAfterMs(res.headers.get('retry-after'), now),
      httpStatus: status,
    });
  }
  if (status >= 400) {
    const transient = status >= 500 || status === 408;
    throw new PsSourceError('http', `HTTP ${status} for ${redacted}`, {
      doNotRetry: !transient,
      httpStatus: status,
    });
  }

  const body = await readCapped(res, opts.maxBytes ?? DEFAULT_MAX_RESPONSE_BYTES, redacted);
  return { httpStatus: status, contentType: res.headers.get('content-type'), body, requestUrlRedacted: redacted };
}

/**
 * Provider HTTP with throttling awareness for Microsoft Graph and Google.
 *
 * A 429 (or a 503 that carries Retry-After) becomes a typed error so the
 * BullMQ job can move itself to delayed for exactly the wait the provider
 * asked for, instead of burning retries while still throttled.
 */

const BASE_BACKOFF_MS = 30_000;
const MAX_BACKOFF_MS = 15 * 60_000;

/** Thrown when the provider asks the caller to slow down. */
export class ProviderRateLimitError extends Error {
  override readonly name = 'ProviderRateLimitError';
  constructor(
    readonly provider: string,
    readonly retryAfterMs: number,
  ) {
    super(`${provider} throttled the request; retry after ${retryAfterMs}ms`);
  }
}

/**
 * Wait derived from a Retry-After header (seconds or HTTP date), else an
 * exponential backoff from the attempt number, capped at 15 minutes.
 */
export function retryAfterMs(header: string | null, attempt: number, now = Date.now()): number {
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_BACKOFF_MS);
    const at = Date.parse(header);
    if (!Number.isNaN(at)) return Math.min(Math.max(at - now, 0), MAX_BACKOFF_MS);
  }
  return Math.min(BASE_BACKOFF_MS * 2 ** Math.max(attempt, 0), MAX_BACKOFF_MS);
}

/** fetch that raises ProviderRateLimitError on throttling responses. */
export async function providerFetch(
  url: string,
  init: RequestInit,
  opts: { provider: string; attempt?: number; fetchImpl?: typeof fetch },
): Promise<Response> {
  const res = await (opts.fetchImpl ?? fetch)(url, init);
  const throttled = res.status === 429 || (res.status === 503 && res.headers.has('Retry-After'));
  if (throttled) {
    throw new ProviderRateLimitError(opts.provider, retryAfterMs(res.headers.get('Retry-After'), opts.attempt ?? 0));
  }
  return res;
}

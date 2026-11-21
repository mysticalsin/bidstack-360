// SSRF-hardened fetch for competitor research and other worker callers.
//
// Each call is one hop. Callers that follow redirects re-enter this function,
// so every hop is pinned again. The socket dials the address pinnedFetch
// checked. There is no second DNS lookup.

import { pinnedFetch, type PinnedResolver, type PinnedTransport } from '@bidstack/shared/server';
import { assertPublicHttpUrl } from '@bidstack/shared';

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface ResearchFetchOptions {
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
  throw new Error('createResearchFetch: unsupported body type');
}

/**
 * Build a fetch that refuses any URL whose host (or any of its resolved IPs)
 * points at internal space, and dials only the address that passed that check.
 * Throws before a request is made on a violation — callers treat a throw as
 * "drop this document".
 */
export function createResearchFetch(_baseFetch?: FetchLike, opts: ResearchFetchOptions = {}): FetchLike {
  return async (input, init) => {
    // String gate first so IP literals and bad schemes never reach DNS.
    assertPublicHttpUrl(input.toString());
    const res = await pinnedFetch(input.toString(), {
      method: init?.method,
      headers: headerRecord(init?.headers),
      body: requestBody(init?.body),
      redirect: 'manual',
      maxHops: 0,
      signal: init?.signal ?? undefined,
      resolve: opts.resolve,
      transport: opts.transport,
      timeoutMs: 120_000,
    });
    return res.toResponse();
  };
}

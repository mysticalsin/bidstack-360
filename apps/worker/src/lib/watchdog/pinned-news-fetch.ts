// Production fetch for watchdog news. GDELT article URLs and a stored IR feed
// are chosen outside this process. pinnedFetch resolves each host once, dials
// that address, and re-checks every redirect. A metadata or private answer
// throws before a socket opens.

import { pinnedFetch, type PinnedResolver, type PinnedTransport } from '@bidstack/shared/server';

import type { NewsFetch } from './news.js';
import { ARTICLE_MAX_BYTES, ARTICLE_TIMEOUT_MS, type BodyFetch } from './news-verify.js';

export interface PinnedNewsDeps {
  resolve?: PinnedResolver;
  transport?: PinnedTransport;
}

/** Article HTML. The caller passes `redirect`, which is ignored: hops are revalidated here. */
export function createPinnedBodyFetch(deps?: PinnedNewsDeps): BodyFetch {
  return async (url, init) => {
    const res = await pinnedFetch(url, {
      headers: init.headers,
      signal: init.signal,
      resolve: deps?.resolve,
      transport: deps?.transport,
      redirect: 'manual',
      maxHops: 3,
      maxBytes: ARTICLE_MAX_BYTES,
      timeoutMs: ARTICLE_TIMEOUT_MS,
    });
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      headers: res.headers,
      body: null,
      text: () => res.text(),
    };
  };
}

/** GDELT, Google News and the account IR feed. Same pin, larger body cap. */
export function createPinnedNewsFetch(deps?: PinnedNewsDeps): NewsFetch {
  return async (url, init) => {
    const res = await pinnedFetch(url, {
      method: init?.method,
      headers: init?.headers,
      body: init?.body,
      signal: init?.signal,
      resolve: deps?.resolve,
      transport: deps?.transport,
      redirect: 'manual',
      maxHops: 3,
      maxBytes: 1_048_576,
      timeoutMs: 15_000,
    });
    return { ok: res.status >= 200 && res.status < 300, status: res.status, text: () => res.text() };
  };
}

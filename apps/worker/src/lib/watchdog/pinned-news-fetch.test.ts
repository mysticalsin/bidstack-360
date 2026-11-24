import { describe, expect, it } from 'vitest';

import { fetchAccountNews, memoryNewsCache, newsConfigFromEnv, type NewsSubject } from './news.js';
import { createPinnedBodyFetch, createPinnedNewsFetch } from './pinned-news-fetch.js';
import type { PinnedDial, PinnedHopResult } from '@bidstack/shared/server';

/**
 * WHY: Hammer ARTEX F-01. GDELT article URLs and a stored IR feed are fetched
 * with redirect: 'follow' and no address pin. A public name that resolves to
 * the metadata service, or a 302 onto that service, must never be dialed.
 */

const METADATA = '169.254.169.254';
const PUBLIC = '93.184.216.34';

const subject: NewsSubject = {
  orgId: 'o1',
  companyId: 'c1',
  companyName: 'Acme Corp',
  domain: 'acme.com',
  ticker: 'ACME',
  exchange: 'NYSE',
  irFeedUrl: 'https://news.example/rss',
  linkedinUrl: null,
  alertUserIds: [],
};

function capture(handler: (dial: PinnedDial) => PinnedHopResult) {
  const dials: PinnedDial[] = [];
  const transport = async (dial: PinnedDial) => {
    dials.push(dial);
    return handler(dial);
  };
  return { dials, transport };
}

describe('news fetches refuse a metadata target (F-01)', () => {
  it('does not dial an article host that resolves to the metadata address', async () => {
    const { dials, transport } = capture(() => ({ status: 200, headers: {}, body: new Uint8Array() }));
    const fetchImpl = createPinnedBodyFetch({
      resolve: async () => [{ address: METADATA, family: 4 }],
      transport,
    });
    await expect(
      fetchImpl('https://news.example/a', { headers: {}, signal: new AbortController().signal, redirect: 'manual' }),
    ).rejects.toThrow(/blocked address/i);
    expect(dials).toEqual([]);
  });

  it('does not dial a metadata redirect from a public article host', async () => {
    const { dials, transport } = capture(() => ({
      status: 302,
      headers: { location: 'http://169.254.169.254/latest/meta-data/' },
      body: new Uint8Array(),
    }));
    const fetchImpl = createPinnedBodyFetch({
      resolve: async () => [{ address: PUBLIC, family: 4 }],
      transport,
    });
    await expect(
      fetchImpl('https://news.example/a', { headers: {}, signal: new AbortController().signal, redirect: 'manual' }),
    ).rejects.toThrow(/blocked address/i);
    expect(dials.map((dial) => dial.address)).toEqual([PUBLIC]);
  });

  it('does not dial an IR feed that resolves to the metadata address', async () => {
    const { dials, transport } = capture(() => ({ status: 200, headers: {}, body: new Uint8Array() }));
    const fetchImpl = createPinnedNewsFetch({
      resolve: async () => [{ address: METADATA, family: 4 }],
      transport,
    });
    const result = await fetchAccountNews(subject, {
      fetchImpl,
      cache: memoryNewsCache(),
      config: newsConfigFromEnv({ WATCHDOG_NEWS_SOURCES: 'company_rss' }),
    });
    expect(dials).toEqual([]);
    expect(result.items).toEqual([]);
    expect(result.errors.some((error) => /blocked address/i.test(error))).toBe(true);
  });
});

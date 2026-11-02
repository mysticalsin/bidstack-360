import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  fetchAccountNews,
  gdeltUrl,
  googleNewsUrl,
  memoryNewsCache,
  parseGdelt,
  type NewsFetch,
} from './news.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__');
const text = (name: string) => readFileSync(join(FIX, name), 'utf8');

describe('news source HTTP contract (recorded fixtures, no network)', () => {
  it('parses the recorded GDELT article list', () => {
    const items = parseGdelt(text('gdelt-articles.json'));
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      source: 'gdelt',
      url: 'https://news.example/acme-series-c',
      publisher: 'news.example',
    });
  });

  it('fetches only recorded GDELT and Google News URLs', async () => {
    const calls: string[] = [];
    const fetchImpl: NewsFetch = async (url) => {
      calls.push(url);
      if (url.startsWith('https://api.gdeltproject.org/')) {
        return { ok: true, status: 200, text: async () => text('gdelt-articles.json') };
      }
      if (url.startsWith('https://news.google.com/rss/search')) {
        return { ok: true, status: 200, text: async () => text('google-news.rss.xml') };
      }
      throw new Error(`http contract: unexpected URL ${url} (network blocked)`);
    };
    const subject = {
      orgId: 'o1',
      companyId: 'c1',
      companyName: 'Acme Corp',
      domain: 'acme.com',
      ticker: 'ACME',
      irFeedUrl: null,
      linkedinUrl: null,
      alertUserIds: [],
    };
    const result = await fetchAccountNews(subject, {
      fetchImpl,
      cache: memoryNewsCache(() => 0),
      config: {
        sources: ['gdelt', 'google_news'],
        cacheTtlSeconds: 3600,
        lookbackDays: 14,
        apify: null,
        userAgent: 'PoloWatchdog/1.0 (http-contract)',
        verifyBody: false,
        maxArticleFetches: 0,
      },
    });
    expect(result.skipped).toBeUndefined();
    expect(result.errors).toEqual([]);
    expect(result.items.some((i) => i.source === 'gdelt' && i.url.includes('acme-series-c'))).toBe(true);
    expect(result.items.some((i) => i.source === 'google_news' && i.url.includes('acme-app'))).toBe(true);
    expect(calls).toEqual([
      gdeltUrl('Acme', 14),
      googleNewsUrl('Acme', 14, { ticker: 'ACME', domain: 'acme.com' }),
    ]);
  });

  it('does not call any source when the account has no website or ticker', async () => {
    const fetchImpl: NewsFetch = async (url) => {
      throw new Error(`http contract: unexpected URL ${url} (network blocked)`);
    };
    const result = await fetchAccountNews(
      {
        orgId: 'o1',
        companyId: 'c1',
        companyName: 'Brand New Co',
        domain: null,
        ticker: null,
        irFeedUrl: null,
        linkedinUrl: null,
        alertUserIds: [],
      },
      {
        fetchImpl,
        cache: memoryNewsCache(),
        config: {
          sources: ['gdelt'],
          cacheTtlSeconds: 3600,
          lookbackDays: 14,
          apify: null,
          userAgent: 'PoloWatchdog/1.0 (http-contract)',
          verifyBody: false,
          maxArticleFetches: 0,
        },
      },
    );
    expect(result).toMatchObject({ items: [], skipped: 'no_identifiers' });
  });
});

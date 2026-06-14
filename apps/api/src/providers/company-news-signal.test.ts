import { describe, expect, it, vi } from 'vitest';

import { fetchCompanyNewsSignals } from './company-news-signal.js';

const SAMPLE_RSS = `<?xml version="1.0"?><rss><channel>
  <title>"Acme" - Google News</title>
  <item>
    <title>Acme raises $50M Series B - TechCrunch</title>
    <link>https://news.google.com/articles/a1</link>
    <pubDate>Mon, 09 Jun 2026 10:00:00 GMT</pubDate>
    <source url="https://techcrunch.com">TechCrunch</source>
  </item>
  <item>
    <title><![CDATA[Acme &amp; Co expands to LATAM]]></title>
    <link>https://news.google.com/articles/a2</link>
    <source url="https://reuters.com">Reuters</source>
  </item>
</channel></rss>`;

function mockFetch(body: string, ok = true): typeof fetch {
  return vi.fn(async () => ({ ok, text: async () => body })) as unknown as typeof fetch;
}

describe('fetchCompanyNewsSignals', () => {
  it('parses items, strips the " - Source" suffix, and decodes entities', async () => {
    const items = await fetchCompanyNewsSignals('Acme', mockFetch(SAMPLE_RSS));
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      title: 'Acme raises $50M Series B',
      url: 'https://news.google.com/articles/a1',
      source: 'TechCrunch',
      publishedAt: new Date('Mon, 09 Jun 2026 10:00:00 GMT').toISOString(),
    });
    // CDATA unwrapped + &amp; decoded; no pubDate → null.
    expect(items[1].title).toBe('Acme & Co expands to LATAM');
    expect(items[1].source).toBe('Reuters');
    expect(items[1].publishedAt).toBeNull();
  });

  it('returns [] on a blank name without fetching', async () => {
    const fetchSpy = mockFetch('');
    expect(await fetchCompanyNewsSignals('   ', fetchSpy)).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fails open to [] on a non-ok response or thrown fetch', async () => {
    expect(await fetchCompanyNewsSignals('Acme', mockFetch('', false))).toEqual([]);
    const throwing = vi.fn(async () => {
      throw new Error('network');
    }) as unknown as typeof fetch;
    expect(await fetchCompanyNewsSignals('Acme', throwing)).toEqual([]);
  });
});

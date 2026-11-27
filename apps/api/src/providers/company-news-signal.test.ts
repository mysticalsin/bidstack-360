import { describe, expect, it, vi } from 'vitest';

import { accountNewsSignalBody, fetchCompanyNewsSignals } from './company-news-signal.js';

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
    const read = await fetchCompanyNewsSignals('Acme', mockFetch(SAMPLE_RSS));
    expect(read.read).toBe('ok');
    if (read.read !== 'ok') return;
    const items = read.items;
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

  it('returns an empty match on a blank name without fetching', async () => {
    const fetchSpy = mockFetch('');
    expect(await fetchCompanyNewsSignals('   ', fetchSpy)).toEqual({ read: 'ok', items: [] });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not treat a feed that did not answer as an empty match for a demo account', async () => {
    // A timeout or a non-200 from the courtesy feed is not "no headlines".
    // Demo accounts such as CI Financial would otherwise look quiet.
    const refused = mockFetch('', false);
    expect(await fetchCompanyNewsSignals('CI Financial', refused)).toEqual({
      read: 'unavailable',
      items: [],
    });
    const throwing = vi.fn(async () => {
      throw new Error('network');
    }) as unknown as typeof fetch;
    expect(await fetchCompanyNewsSignals('DNB Bank', throwing)).toEqual({
      read: 'unavailable',
      items: [],
    });
  });

  it('does not attach a confidence score when the feed did not answer', () => {
    const fetchedAt = '2026-06-17T12:00:00.000Z';
    const missed = accountNewsSignalBody({ read: 'unavailable', items: [] }, fetchedAt, 'CI Financial');
    expect(missed).toEqual({
      source: 'google-news',
      fetchedAt,
      read: 'unavailable',
      items: [],
    });
    expect(missed).not.toHaveProperty('sourceAttribution');

    const answered = accountNewsSignalBody(
      { read: 'ok', items: [] },
      fetchedAt,
      'CI Financial',
    );
    expect(answered.read).toBe('ok');
    expect(answered.sourceAttribution?.confidence).toBe(0.62);
  });
});
